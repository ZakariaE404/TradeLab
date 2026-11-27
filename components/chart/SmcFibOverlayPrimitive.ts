import {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { SmcFibBarPoint, SmcFibChartOverlay, SmcFibZoneSegment, SmcStructureEvent } from '@/types/trading';

interface ZoneRect {
  x1: number;
  x2: number;
  yTop: number;
  yBottom: number;
  direction: 'BULL' | 'BEAR';
}

interface SwingSegment {
  x1: number;
  x2: number;
  y: number;
  isHigh: boolean;
}

interface StructureLine {
  x1: number;
  x2: number;
  y: number;
  type: SmcStructureEvent['type'];
}

class SmcFibPaneRenderer implements IPrimitivePaneRenderer {
  private rects: ZoneRect[] = [];
  private swingLines: SwingSegment[] = [];
  private structureLines: StructureLine[] = [];

  public setRenderData(
    rects: ZoneRect[],
    swingLines: SwingSegment[],
    structureLines: StructureLine[]
  ): void {
    this.rects = rects;
    this.swingLines = swingLines;
    this.structureLines = structureLines;
  }

  public draw(target: CanvasRenderingTarget2D): void {
    if (
      this.rects.length === 0 &&
      this.swingLines.length === 0 &&
      this.structureLines.length === 0
    ) {
      return;
    }

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      // 1. Dynamic Fibonacci 0.60 - 0.70 Shaded Zones
      for (const r of this.rects) {
        const left = Math.min(r.x1, r.x2);
        const width = Math.max(1, Math.abs(r.x2 - r.x1));
        const top = Math.min(r.yTop, r.yBottom);
        const height = Math.max(1, Math.abs(r.yBottom - r.yTop));

        const isBull = r.direction === 'BULL';
        ctx.fillStyle = isBull ? 'rgba(16, 185, 129, 0.14)' : 'rgba(244, 63, 94, 0.14)';
        ctx.fillRect(left, top, width, height);

        ctx.strokeStyle = isBull ? 'rgba(16, 185, 129, 0.65)' : 'rgba(244, 63, 94, 0.65)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(left + width, top);
        ctx.moveTo(left, top + height);
        ctx.lineTo(left + width, top + height);
        ctx.stroke();
      }

      // 2. Last Confirmed Swing High / Low Levels
      if (this.swingLines.length > 0) {
        ctx.save();
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        for (const s of this.swingLines) {
          ctx.strokeStyle = s.isHigh ? 'rgba(148, 163, 184, 0.45)' : 'rgba(148, 163, 184, 0.45)';
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y);
          ctx.lineTo(s.x2, s.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 3. BOS / CHOCH Break Level Segments
      if (this.structureLines.length > 0) {
        ctx.save();
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        for (const l of this.structureLines) {
          const isBull = l.type === 'BULL_BOS' || l.type === 'BULL_CHOCH';
          const isChoch = l.type === 'BULL_CHOCH' || l.type === 'BEAR_CHOCH';
          ctx.strokeStyle = isChoch
            ? isBull
              ? 'rgba(56, 189, 248, 0.85)'
              : 'rgba(251, 146, 60, 0.85)'
            : isBull
            ? 'rgba(16, 185, 129, 0.8)'
            : 'rgba(244, 63, 94, 0.8)';
          ctx.beginPath();
          ctx.moveTo(l.x1, l.y);
          ctx.lineTo(l.x2, l.y);
          ctx.stroke();
        }
        ctx.restore();
      }
    });
  }
}

class SmcFibPaneView implements IPrimitivePaneView {
  private readonly rendererInstance = new SmcFibPaneRenderer();

  public zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }

  public update(
    rects: ZoneRect[],
    swingLines: SwingSegment[],
    structureLines: StructureLine[]
  ): void {
    this.rendererInstance.setRenderData(rects, swingLines, structureLines);
  }

  public renderer(): IPrimitivePaneRenderer {
    return this.rendererInstance;
  }
}

export class SmcFibOverlayPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate?: () => void;
  private readonly paneView = new SmcFibPaneView();

  private overlay: SmcFibChartOverlay | null = null;
  private showZones = true;
  private showStructure = true;

  public attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  public detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }

  public setData(
    overlay: SmcFibChartOverlay | null | undefined,
    showZones: boolean,
    showStructure: boolean
  ): void {
    this.overlay = overlay || null;
    this.showZones = showZones;
    this.showStructure = showStructure;
    this.updateAllViews();
    this.requestUpdate?.();
  }

  public updateAllViews(): void {
    if (!this.chart || !this.series || !this.overlay) {
      this.paneView.update([], [], []);
      return;
    }

    const timeScale = this.chart.timeScale();
    const rects: ZoneRect[] = [];
    const swingLines: SwingSegment[] = [];
    const structureLines: StructureLine[] = [];

    if (this.showZones) {
      const segments: SmcFibZoneSegment[] = this.overlay.fibZoneSegments || [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const x1Raw = timeScale.timeToCoordinate(seg.startTime as Time);
        if (x1Raw === null) continue;
        const x1 = Number(x1Raw);
        const x2Raw = timeScale.timeToCoordinate(seg.endTime as Time);
        const x2 = x2Raw !== null ? Number(x2Raw) : x1 + 8;
        const yTop = this.series.priceToCoordinate(seg.top);
        const yBottom = this.series.priceToCoordinate(seg.bottom);
        if (yTop === null || yBottom === null) continue;

        rects.push({
          x1,
          x2,
          yTop: Number(yTop),
          yBottom: Number(yBottom),
          direction: seg.direction,
        });
      }

      const bars: SmcFibBarPoint[] = this.overlay.barSeries || [];
      for (let i = 0; i < bars.length - 1; i++) {
        const cur = bars[i];
        const next = bars[i + 1];
        const x1 = timeScale.timeToCoordinate(cur.time as Time);
        const x2 = timeScale.timeToCoordinate(next.time as Time);
        if (x1 === null || x2 === null) continue;

        if (cur.lastHigh !== null) {
          const y = this.series.priceToCoordinate(cur.lastHigh);
          if (y !== null) swingLines.push({ x1, x2, y, isHigh: true });
        }
        if (cur.lastLow !== null) {
          const y = this.series.priceToCoordinate(cur.lastLow);
          if (y !== null) swingLines.push({ x1, x2, y, isHigh: false });
        }
      }
    }

    if (this.showStructure) {
      const events: SmcStructureEvent[] = this.overlay.structureEvents || [];
      for (const ev of events) {
        const x = timeScale.timeToCoordinate(ev.time as Time);
        const y = this.series.priceToCoordinate(ev.brokenLevel);
        if (x === null || y === null) continue;
        structureLines.push({
          x1: x - 28,
          x2: x + 6,
          y,
          type: ev.type,
        });
      }
    }

    this.paneView.update(rects, swingLines, structureLines);
  }

  public paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView];
  }
}
