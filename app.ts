import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Download,
  Layers,
  Ruler,
  ScanLine,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DeviceType = "logic" | "memory" | "power" | "sensor";
type Fragility = "low" | "medium" | "high";
type FinishQuality = "standard" | "premium";
type ProcessMode = "production" | "r_and_d" | "aggressive";
type RiskLevel = "low" | "medium" | "high" | "very_high";

type BuildRecordInput = {
  waferDiameterMm: number;
  incomingThicknessUm: number;
  edgeExclusionMm: number;
  dieLengthMm: number;
  dieWidthMm: number;
  scribeXmm: number;
  scribeYmm: number;
  streetLossPercent: number;
  targetThicknessUm: number;
  ttvUm: number;
  bowWarpUm: number;
  deviceType: DeviceType;
  fragility: Fragility;
  finishQuality: FinishQuality;
  processMode: ProcessMode;
  knownFromMap: boolean;
  knownFromSawSheet: boolean;
  knownFromImage: boolean;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function mm2ToCm2(value: number): number {
  return value / 100;
}

function estimatePackedDies(usableDiameterMm: number, pitchXmm: number, pitchYmm: number): number {
  if (usableDiameterMm <= 0 || pitchXmm <= 0 || pitchYmm <= 0) return 0;

  const radius = usableDiameterMm / 2;
  let count = 0;

  for (let x = -radius + pitchXmm / 2; x <= radius - pitchXmm / 2; x += pitchXmm) {
    for (let y = -radius + pitchYmm / 2; y <= radius - pitchYmm / 2; y += pitchYmm) {
      const halfX = pitchXmm / 2;
      const halfY = pitchYmm / 2;

      const corners = [
        [x - halfX, y - halfY],
        [x + halfX, y - halfY],
        [x - halfX, y + halfY],
        [x + halfX, y + halfY],
      ];

      const fits = corners.every(([cx, cy]) => cx * cx + cy * cy <= radius * radius);
      if (fits) count += 1;
    }
  }

  return count;
}

function splitGrindingRemoval(removalUm: number, finishQuality: FinishQuality) {
  const removal = clampNonNegative(removalUm);

  if (removal > 600) {
    const coarse = Math.round(removal * 0.8);
    const fine = Math.round(removal * 0.15);
    const polish = Math.max(0, removal - coarse - fine);
    return { coarse, fine, polish };
  }

  if (removal > 300) {
    const coarse = Math.round(removal * 0.7);
    const fine = removal - coarse;
    return { coarse, fine, polish: finishQuality === "premium" ? 10 : 0 };
  }

  const coarse = Math.round(removal * 0.6);
  const fine = removal - coarse;
  return { coarse, fine, polish: finishQuality === "premium" ? 8 : 0 };
}

function deriveStressRisk(targetThicknessUm: number, dieAreaMm2: number, fragility: Fragility): RiskLevel {
  const slenderness = Math.sqrt(Math.max(dieAreaMm2, 0)) / Math.max(targetThicknessUm, 1);
  let risk: RiskLevel = "low";

  if (targetThicknessUm < 60 || slenderness > 0.22) risk = "very_high";
  else if (targetThicknessUm < 100 || slenderness > 0.14) risk = "high";
  else if (targetThicknessUm < 180 || slenderness > 0.08) risk = "medium";

  if (fragility === "high" && risk === "low") return "medium";
  if (fragility === "high" && risk === "medium") return "high";
  if (fragility === "high" && risk === "high") return "very_high";

  return risk;
}

function deriveTtvRisk(ttvUm: number, targetThicknessUm: number): RiskLevel {
  if (ttvUm <= 0 || targetThicknessUm <= 0) return "low";
  const ratio = ttvUm / targetThicknessUm;
  if (ratio > 0.1) return "very_high";
  if (ratio > 0.05) return "high";
  if (ratio > 0.02) return "medium";
  return "low";
}

function deriveBowWarpRisk(bowWarpUm: number, targetThicknessUm: number): RiskLevel {
  if (bowWarpUm <= 0 || targetThicknessUm <= 0) return "low";
  const ratio = bowWarpUm / targetThicknessUm;
  if (ratio > 0.5) return "very_high";
  if (ratio > 0.25) return "high";
  if (ratio > 0.1) return "medium";
  return "low";
}

function getRiskScore(risk: RiskLevel): number {
  return {
    low: 1,
    medium: 2,
    high: 3,
    very_high: 4,
  }[risk];
}

function maxRisk(...risks: RiskLevel[]): RiskLevel {
  return risks.reduce((highest, current) =>
    getRiskScore(current) > getRiskScore(highest) ? current : highest
  , "low");
}

function buildWarnings(input: BuildRecordInput, overallRisk: RiskLevel, polishUm: number): string[] {
  const warnings: string[] = [];

  if (input.targetThicknessUm <= 100) {
    warnings.push("Ultra-thin target detected: review warpage, edge chipping, and tape support.");
  }

  if (input.targetThicknessUm < 60) {
    warnings.push("Temporary bonding or carrier support is strongly recommended below 60 µm.");
  }

  if (input.fragility === "high") {
    warnings.push("High-fragility material/device: reduce chuck stress and feed rate.");
  }

  if (input.deviceType === "power") {
    warnings.push("Power devices may require tighter thickness uniformity and thermal-mechanical review.");
  }

  if (input.deviceType === "logic" || input.deviceType === "memory") {
    warnings.push("Review scribe-line strength and low-k stack sensitivity before thinning.");
  }

  if (input.processMode === "aggressive" && input.targetThicknessUm < 80) {
    warnings.push("Aggressive thinning mode selected: fracture probability is elevated at this target thickness.");
  }

  if (input.ttvUm > 0) {
    warnings.push("TTV input provided: verify grinder setup against final thickness uniformity goals.");
  }

  if (input.bowWarpUm > 0) {
    warnings.push("Bow/warp input provided: validate handling, tape adhesion, and downstream assembly compatibility.");
  }

  if (polishUm > 0) {
    warnings.push("Polish/stress relief step is recommended after fine grind for the current removal regime.");
  }

  if (overallRisk === "very_high") {
    warnings.push("Overall mechanical risk is very high: process release should be gated by metrology and handling review.");
  }

  return warnings;
}

function buildRecord(input: BuildRecordInput) {
  const dieAreaMm2 = clampNonNegative(input.dieLengthMm) * clampNonNegative(input.dieWidthMm);
  const pitchXmm = clampNonNegative(input.dieLengthMm + input.scribeXmm);
  const pitchYmm = clampNonNegative(input.dieWidthMm + input.scribeYmm);
  const usableDiameterMm = clampNonNegative(input.waferDiameterMm - 2 * input.edgeExclusionMm);
  const usableRadiusMm = usableDiameterMm / 2;
  const usableAreaMm2 = Math.PI * usableRadiusMm * usableRadiusMm;
  const pitchAreaMm2 = pitchXmm * pitchYmm;

  const areaMethodGrossDies = pitchAreaMm2 > 0 ? Math.floor(usableAreaMm2 / pitchAreaMm2) : 0;
  const packedGrossDies = estimatePackedDies(usableDiameterMm, pitchXmm, pitchYmm);
  const grossDies = packedGrossDies || areaMethodGrossDies;
  const netDies = Math.max(0, Math.floor(grossDies * (1 - input.streetLossPercent / 100)));

  const materialRemovalUm = clampNonNegative(input.incomingThicknessUm - input.targetThicknessUm);
  const { coarse, fine, polish } = splitGrindingRemoval(materialRemovalUm, input.finishQuality);

  const dataConfidenceScore = Math.min(
    100,
    [input.knownFromMap, input.knownFromSawSheet, input.knownFromImage].filter(Boolean).length * 33 +
      (input.knownFromMap ? 1 : 0)
  );

  const stressRisk = deriveStressRisk(input.targetThicknessUm, dieAreaMm2, input.fragility);
  const ttvRisk = deriveTtvRisk(input.ttvUm, input.targetThicknessUm);
  const bowWarpRisk = deriveBowWarpRisk(input.bowWarpUm, input.targetThicknessUm);
  const overallRisk = maxRisk(stressRisk, ttvRisk, bowWarpRisk);

  const tape =
    input.targetThicknessUm < 60
      ? "Temporary bond / carrier support"
      : input.targetThicknessUm <= 100
        ? "High-support UV tape with edge protection"
        : "Standard UV tape";

  const finish =
    polish > 0
      ? "Fine grind + stress relief / polish"
      : input.finishQuality === "premium"
        ? "Fine grind + premium finish review"
        : "Fine grind";

  const warnings = buildWarnings(input, overallRisk, polish);

  return {
    geometry: {
      dieAreaMm2: round(dieAreaMm2, 3),
      dieAreaCm2: round(mm2ToCm2(dieAreaMm2), 4),
      pitchXmm: round(pitchXmm, 3),
      pitchYmm: round(pitchYmm, 3),
      pitchAreaMm2: round(pitchAreaMm2, 3),
      usableAreaMm2: round(usableAreaMm2, 2),
      usableDiameterMm: round(usableDiameterMm, 3),
      areaMethodGrossDies,
      packedGrossDies,
      grossDies,
      netDies,
    },
    grinding: {
      materialRemovalUm: round(materialRemovalUm, 1),
      coarseGrindUm: round(coarse, 1),
      fineGrindUm: round(fine, 1),
      polishUm: round(polish, 1),
      tape,
      finish,
    },
    risk: {
      stressRisk,
      ttvRisk,
      bowWarpRisk,
      overallRisk,
    },
    confidence: {
      score: dataConfidenceScore,
    },
    warnings,
  };
}

function riskBadgeVariant(risk: RiskLevel): "secondary" | "outline" | "destructive" {
  if (risk === "high" || risk === "very_high") return "destructive";
  if (risk === "medium") return "outline";
  return "secondary";
}

export default function DieDimensionsAndBackGrindingApp() {
  const [waferDiameter, setWaferDiameter] = useState(300);
  const [waferThickness, setWaferThickness] = useState(775);
  const [dieLength, setDieLength] = useState(8);
  const [dieWidth, setDieWidth] = useState(6);
  const [scribeX, setScribeX] = useState(0.08);
  const [scribeY, setScribeY] = useState(0.08);
  const [edgeExclusion, setEdgeExclusion] = useState(3);
  const [streetLossPct, setStreetLossPct] = useState([6]);
  const [targetThickness, setTargetThickness] = useState(120);
  const [ttvUm, setTtvUm] = useState(0);
  const [bowWarpUm, setBowWarpUm] = useState(0);
  const [deviceType, setDeviceType] = useState<DeviceType>("logic");
  const [fragility, setFragility] = useState<Fragility>("medium");
  const [grindQuality, setGrindQuality] = useState<FinishQuality>("standard");
  const [processMode, setProcessMode] = useState<ProcessMode>("production");
  const [knownFromImage, setKnownFromImage] = useState(false);
  const [knownFromMap, setKnownFromMap] = useState(true);
  const [knownFromSawSheet, setKnownFromSawSheet] = useState(false);

  const record = useMemo(
    () =>
      buildRecord({
        waferDiameterMm: waferDiameter,
        incomingThicknessUm: waferThickness,
        edgeExclusionMm: edgeExclusion,
        dieLengthMm: dieLength,
        dieWidthMm: dieWidth,
        scribeXmm: scribeX,
        scribeYmm: scribeY,
        streetLossPercent: streetLossPct[0],
        targetThicknessUm: targetThickness,
        ttvUm,
        bowWarpUm,
        deviceType,
        fragility,
        finishQuality: grindQuality,
        processMode,
        knownFromMap,
        knownFromSawSheet,
        knownFromImage,
      }),
    [
      waferDiameter,
      waferThickness,
      edgeExclusion,
      dieLength,
      dieWidth,
      scribeX,
      scribeY,
      streetLossPct,
      targetThickness,
      ttvUm,
      bowWarpUm,
      deviceType,
      fragility,
      grindQuality,
      processMode,
      knownFromMap,
      knownFromSawSheet,
      knownFromImage,
    ]
  );

  const identificationHints = [
    {
      source: "Wafer map / die map",
      what: "Best source for nominal die size, placement pattern, row-column arrangement, and edge exclusion assumptions.",
    },
    {
      source: "Saw street / dicing sheet",
      what: "Confirms street width, kerf assumptions, singulation pitch, and post-thin handling constraints.",
    },
    {
      source: "Microscope / image metrology",
      what: "Validates actual feature-to-feature die size and catches corner losses or exclusion zones.",
    },
    {
      source: "Backgrind traveler",
      what: "Captures incoming thickness, target thickness, grind sequence, and required finish steps.",
    },
  ];

  const checklist = [
    "Confirm wafer diameter and incoming thickness from traveler or incoming inspection",
    "Identify die X and Y dimensions from wafer map or reticle data",
    "Capture saw street width in both axes before pitch calculation",
    "Apply edge exclusion before estimating wafer utilization",
    "Review die size against image metrology where available",
    "Define target thickness, TTV, and bow/warp acceptance criteria",
    "Choose tape or temporary bonding based on thin-wafer handling risk",
    "Gate release using post-grind finish, metrology, and downstream assembly constraints",
  ];

  function exportTravelerJson() {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "die-backgrind-traveler.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mx-auto max-w-7xl space-y-6"
      >
        <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white p-2 shadow-sm">
                  <ScanLine className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-2xl">Die Dimension + Back Grinding Identifier</CardTitle>
                  <CardDescription>
                    Estimator for die sizing, wafer packing, thinning removal, and mechanical risk review.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Evidence confidence</CardTitle>
              <CardDescription>Confidence based on the sources used for die and process identification.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={record.confidence.score} />
              <div className="text-sm text-slate-600">Confidence score: {record.confidence.score}%</div>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox checked={knownFromMap} onCheckedChange={(v) => setKnownFromMap(Boolean(v))} />
                  <Label>Die map available</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={knownFromSawSheet} onCheckedChange={(v) => setKnownFromSawSheet(Boolean(v))} />
                  <Label>Saw/dicing sheet available</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={knownFromImage} onCheckedChange={(v) => setKnownFromImage(Boolean(v))} />
                  <Label>Microscope/image metrology available</Label>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="inputs" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 rounded-2xl">
            <TabsTrigger value="inputs">Inputs</TabsTrigger>
            <TabsTrigger value="die">Die sizing</TabsTrigger>
            <TabsTrigger value="grinding">Back grinding</TabsTrigger>
            <TabsTrigger value="guide">Guide</TabsTrigger>
          </TabsList>

          <TabsContent value="inputs">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><Ruler className="h-4 w-4" /> Geometry inputs</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Wafer diameter (mm)</Label>
                    <Input type="number" value={waferDiameter} onChange={(e) => setWaferDiameter(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Incoming wafer thickness (µm)</Label>
                    <Input type="number" value={waferThickness} onChange={(e) => setWaferThickness(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Die length X (mm)</Label>
                    <Input type="number" value={dieLength} onChange={(e) => setDieLength(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Die width Y (mm)</Label>
                    <Input type="number" value={dieWidth} onChange={(e) => setDieWidth(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Scribe / street X (mm)</Label>
                    <Input type="number" step="0.01" value={scribeX} onChange={(e) => setScribeX(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Scribe / street Y (mm)</Label>
                    <Input type="number" step="0.01" value={scribeY} onChange={(e) => setScribeY(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Edge exclusion (mm)</Label>
                    <Input type="number" step="0.1" value={edgeExclusion} onChange={(e) => setEdgeExclusion(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Street / edge loss allowance (%)</Label>
                    <div className="px-1 pt-3">
                      <Slider value={streetLossPct} onValueChange={setStreetLossPct} max={25} step={1} />
                      <div className="pt-2 text-sm text-slate-600">{streetLossPct[0]}%</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><Layers className="h-4 w-4" /> Process inputs</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Target post-grind thickness (µm)</Label>
                    <Input type="number" value={targetThickness} onChange={(e) => setTargetThickness(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>TTV (µm)</Label>
                    <Input type="number" value={ttvUm} onChange={(e) => setTtvUm(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Bow / warp (µm)</Label>
                    <Input type="number" value={bowWarpUm} onChange={(e) => setBowWarpUm(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Device type</Label>
                    <Select value={deviceType} onValueChange={(value: DeviceType) => setDeviceType(value)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="logic">Logic</SelectItem>
                        <SelectItem value="memory">Memory</SelectItem>
                        <SelectItem value="power">Power</SelectItem>
                        <SelectItem value="sensor">Sensor / MEMS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Fragility level</Label>
                    <Select value={fragility} onValueChange={(value: Fragility) => setFragility(value)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Finish quality</Label>
                    <Select value={grindQuality} onValueChange={(value: FinishQuality) => setGrindQuality(value)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="premium">Premium</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Process mode</Label>
                    <Select value={processMode} onValueChange={(value: ProcessMode) => setProcessMode(value)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="production">Production</SelectItem>
                        <SelectItem value="r_and_d">R&amp;D</SelectItem>
                        <SelectItem value="aggressive">Aggressive thinning</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="die">
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><Calculator className="h-4 w-4" /> Calculated die metrics</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metric</TableHead>
                        <TableHead>Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow><TableCell>Die area</TableCell><TableCell>{record.geometry.dieAreaMm2} mm²</TableCell></TableRow>
                      <TableRow><TableCell>Die area</TableCell><TableCell>{record.geometry.dieAreaCm2} cm²</TableCell></TableRow>
                      <TableRow><TableCell>Pitch X</TableCell><TableCell>{record.geometry.pitchXmm} mm</TableCell></TableRow>
                      <TableRow><TableCell>Pitch Y</TableCell><TableCell>{record.geometry.pitchYmm} mm</TableCell></TableRow>
                      <TableRow><TableCell>Pitch footprint</TableCell><TableCell>{record.geometry.pitchAreaMm2} mm²</TableCell></TableRow>
                      <TableRow><TableCell>Usable diameter</TableCell><TableCell>{record.geometry.usableDiameterMm} mm</TableCell></TableRow>
                      <TableRow><TableCell>Usable wafer area</TableCell><TableCell>{record.geometry.usableAreaMm2} mm²</TableCell></TableRow>
                      <TableRow><TableCell>Gross dies (packed estimate)</TableCell><TableCell>{record.geometry.grossDies}</TableCell></TableRow>
                      <TableRow><TableCell>Gross dies (area method)</TableCell><TableCell>{record.geometry.areaMethodGrossDies}</TableCell></TableRow>
                      <TableRow><TableCell>Estimated net dies</TableCell><TableCell>{record.geometry.netDies}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">How to identify die dimensions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  {identificationHints.map((item) => (
                    <div key={item.source} className="rounded-xl border bg-white p-3">
                      <div className="font-medium">{item.source}</div>
                      <div>{item.what}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="grinding">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Recommended back-grind flow</CardTitle>
                  <CardDescription>Engineering heuristics for process planning, not a fab release recipe.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">Removal: {record.grinding.materialRemovalUm} µm</Badge>
                    <Badge variant="secondary">Coarse: {record.grinding.coarseGrindUm} µm</Badge>
                    <Badge variant="secondary">Fine: {record.grinding.fineGrindUm} µm</Badge>
                    <Badge variant="secondary">Polish: {record.grinding.polishUm} µm</Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant={riskBadgeVariant(record.risk.stressRisk)}>Stress risk: {record.risk.stressRisk}</Badge>
                    <Badge variant={riskBadgeVariant(record.risk.ttvRisk)}>TTV risk: {record.risk.ttvRisk}</Badge>
                    <Badge variant={riskBadgeVariant(record.risk.bowWarpRisk)}>Bow/warp risk: {record.risk.bowWarpRisk}</Badge>
                    <Badge variant={riskBadgeVariant(record.risk.overallRisk)}>Overall: {record.risk.overallRisk}</Badge>
                  </div>

                  <Table>
                    <TableBody>
                      <TableRow><TableCell className="font-medium">Carrier / tape</TableCell><TableCell>{record.grinding.tape}</TableCell></TableRow>
                      <TableRow><TableCell className="font-medium">Suggested finish</TableCell><TableCell>{record.grinding.finish}</TableCell></TableRow>
                      <TableRow><TableCell className="font-medium">Device type</TableCell><TableCell className="capitalize">{deviceType}</TableCell></TableRow>
                      <TableRow><TableCell className="font-medium">Fragility</TableCell><TableCell className="capitalize">{fragility}</TableCell></TableRow>
                      <TableRow><TableCell className="font-medium">Process mode</TableCell><TableCell>{processMode.replaceAll("_", " ")}</TableCell></TableRow>
                    </TableBody>
                  </Table>

                  <div className="space-y-3">
                    {record.warnings.length > 0 ? (
                      record.warnings.map((warning, idx) => (
                        <Alert key={idx} className="rounded-xl">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>Review needed</AlertTitle>
                          <AlertDescription>{warning}</AlertDescription>
                        </Alert>
                      ))
                    ) : (
                      <Alert className="rounded-xl">
                        <CheckCircle2 className="h-4 w-4" />
                        <AlertTitle>Baseline flow looks feasible</AlertTitle>
                        <AlertDescription>
                          Current geometry and thinning targets appear reasonable for an initial planning pass.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Process checklist</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {checklist.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 rounded-xl border bg-white p-3">
                      <div className="mt-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">{idx + 1}</div>
                      <div>{item}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="guide">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">What changed in this rewrite</CardTitle>
                <CardDescription>Moved from a simple estimator to a more engineering-aware planning tool.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm text-slate-700 md:grid-cols-2">
                <div className="rounded-xl border bg-white p-4">
                  <div className="mb-2 font-medium">Better die count logic</div>
                  <p>
                    Uses a packing-style die estimate instead of relying only on wafer-area divided by pitch-area.
                  </p>
                </div>
                <div className="rounded-xl border bg-white p-4">
                  <div className="mb-2 font-medium">Better grind split</div>
                  <p>
                    Splits removal into coarse, fine, and optional polish/stress-relief steps depending on removal depth and finish quality.
                  </p>
                </div>
                <div className="rounded-xl border bg-white p-4">
                  <div className="mb-2 font-medium">Mechanical risk inputs</div>
                  <p>
                    Adds TTV and bow/warp inputs and rolls them into an overall risk signal alongside thin-wafer stress risk.
                  </p>
                </div>
                <div className="rounded-xl border bg-white p-4">
                  <div className="mb-2 font-medium">Exportable output</div>
                  <p>
                    Exports the calculated planning record as JSON for traveler, logging, or later API integration.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap gap-3">
          <Button className="rounded-2xl" onClick={exporttravelerJson}>
            <Download className="mr-2 h-4 w-4" />
            Export traveler JSON
          </Button>
          <Button variant="outline" className="rounded-2xl">
            Save recipe snapshot
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
