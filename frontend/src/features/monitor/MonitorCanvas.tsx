import { useEffect, useRef } from 'react';
import { init, use as registerComponents, type ComposeOption } from 'echarts/core';
import { LineChart, type LineSeriesOption } from 'echarts/charts';
import {
  AxisPointerComponent,
  DataZoomSliderComponent,
  GridComponent,
  type AxisPointerComponentOption,
  type DataZoomComponentOption,
  type GridComponentOption,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { chartSeries, nearestSample, rate, seriesCeiling } from './chartData';
import type { Metric, Point } from './history';

registerComponents([
  LineChart,
  GridComponent,
  AxisPointerComponent,
  DataZoomSliderComponent,
  CanvasRenderer,
]);

export type Plot = {
  id: string;
  metrics: Metric[];
  ceiling?: number;
};

type Props = {
  plots: Plot[];
  points: Point[];
  start: number;
  end: number;
  detailed: boolean;
  zoom: [number, number] | undefined;
  locale: string;
  selectedTime: number | undefined;
  pinned: boolean;
  onHover(time: number | null | undefined): void;
  onPin(time: number): void;
  onZoom(range: [number, number]): void;
};

type ChartOption = ComposeOption<
  LineSeriesOption | GridComponentOption | AxisPointerComponentOption | DataZoomComponentOption
>;

export default function MonitorCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const redraw = useRef<() => void>();
  const showPointer = useRef<() => void>();

  useEffect(() => {
    const element = host.current;
    const layout = element?.parentElement;
    if (!element || !layout) return;

    const chart = init(element, undefined, { renderer: 'canvas' });
    const surface = chart.getZr();
    let drawFrame = 0;
    let hoverFrame = 0;
    let pointer: [number, number] | undefined;
    let firstGridCenter = 0;
    let width = 0;
    let height = 0;

    function updatePointer() {
      const time = latest.current.selectedTime;
      if (time === undefined || !firstGridCenter) {
        chart.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' });
        return;
      }
      const x = chart.convertToPixel({ xAxisIndex: 0 }, time);
      if (!Number.isFinite(x)) return;
      chart.dispatchAction({
        type: 'updateAxisPointer',
        x,
        y: firstGridCenter,
        axesInfo: [{ axisDim: 'x', axisIndex: 0, value: time }],
      });
    }

    function draw() {
      drawFrame = 0;
      if (!element!.clientWidth || !element!.clientHeight) return;
      const { plots, points, start, end, detailed, zoom, locale } = latest.current;
      const slots = [...layout!.querySelectorAll<HTMLElement>('.monitor-plot')];
      if (slots.length !== plots.length) return;
      if (width !== element!.clientWidth || height !== element!.clientHeight) {
        width = element!.clientWidth;
        height = element!.clientHeight;
        chart.resize({ width, height, silent: true });
      }
      const style = getComputedStyle(element!);
      const color = (name: string) => style.getPropertyValue(`--color-${name}`).trim();
      const border = color('border-strong');
      const muted = color('muted');
      const colors = [color('primary'), color('success')];
      const timeLabel = new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        ...(detailed ? { second: '2-digit' } : {}),
        hourCycle: 'h23',
      });
      const grid = slots.map((slot, index) => {
        const top = slot.offsetTop + 5;
        const height = slot.offsetHeight - (detailed ? 59 : 21);
        if (index === 0) firstGridCenter = top + height / 2;
        return {
          id: `grid-${index}`,
          left: slot.offsetLeft + 56,
          top,
          width: Math.max(1, slot.offsetWidth - 73),
          height: Math.max(1, height),
          outerBoundsMode: 'none' as const,
        };
      });
      const option: ChartOption = {
        animation: false,
        textStyle: { fontFamily: style.fontFamily },
        grid,
        axisPointer: {
          triggerOn: 'none',
          link: [{ xAxisIndex: 'all' }],
          animation: false,
        },
        xAxis: plots.map((_plot, gridIndex) => ({
          id: `time-${gridIndex}`,
          gridIndex,
          type: 'time',
          min: start,
          max: end,
          axisLine: { lineStyle: { color: border } },
          axisTick: { show: false },
          axisLabel: {
            color: muted,
            fontSize: 10,
            showMinLabel: false,
            showMaxLabel: false,
            hideOverlap: true,
            formatter: (time: number) => timeLabel.format(time),
          },
          splitNumber: detailed ? 6 : 3,
          splitLine: { show: false },
          axisPointer: {
            show: true,
            snap: false,
            triggerTooltip: false,
            label: { show: false },
            lineStyle: { color: muted },
          },
        })),
        yAxis: plots.map(({ id, ceiling, metrics }, gridIndex) => ({
          id: `value-${gridIndex}`,
          gridIndex,
          type: 'value',
          min: 0,
          max:
            detailed && id === 'cpu'
              ? Math.min(100, seriesCeiling(points, metrics, start, end))
              : (ceiling ?? seriesCeiling(points, metrics, start - 12_000, end)),
          minInterval: ceiling ? undefined : 1,
          splitNumber: detailed ? 4 : 2,
          axisLabel: {
            color: muted,
            fontSize: 10,
            hideOverlap: true,
            margin: 6,
            formatter: (value: number) =>
              ceiling ? `${value}%` : value < 1024 ? `${value} B/s` : rate(value),
          },
          splitLine: { lineStyle: { color: border } },
        })),
        dataZoom: detailed
          ? [
              {
                type: 'slider',
                xAxisIndex: 0,
                filterMode: 'none',
                start: zoom?.[0] ?? 0,
                end: zoom?.[1] ?? 100,
                minValueSpan: 3_000,
                height: 20,
                bottom: 4,
                left: 56,
                right: 17,
                showDataShadow: false,
                brushSelect: false,
                labelFormatter: (time: number) => timeLabel.format(time),
                borderColor: border,
                backgroundColor: color('elevated'),
                fillerColor: color('selected'),
                handleStyle: { color: muted },
                textStyle: { color: muted },
              },
            ]
          : [],
        series: plots.flatMap(({ metrics }, axisIndex) =>
          metrics.map((metric, index) => {
            const data = chartSeries(points, metric);
            return {
              id: metric,
              type: 'line',
              xAxisIndex: axisIndex,
              yAxisIndex: axisIndex,
              data,
              connectNulls: false,
              symbol: (_value, { dataIndex }) =>
                data[dataIndex - 1]?.[1] == null && data[dataIndex + 1]?.[1] == null
                  ? 'circle'
                  : 'none',
              symbolSize: 4,
              lineStyle: { color: colors[index], width: 1.5, type: index ? 'dashed' : 'solid' },
              itemStyle: { color: colors[index] },
              emphasis: { disabled: true },
            };
          }),
        ),
      };
      chart.setOption(option, { replaceMerge: ['grid', 'xAxis', 'yAxis', 'series', 'dataZoom'] });
      updatePointer();
    }

    function scheduleDraw() {
      if (!drawFrame) drawFrame = requestAnimationFrame(draw);
    }
    redraw.current = scheduleDraw;
    showPointer.current = updatePointer;

    function timeAt(position: [number, number]) {
      const index = latest.current.plots.findIndex((_plot, gridIndex) =>
        chart.containPixel({ gridIndex }, position),
      );
      if (index < 0) return;
      const time = chart.convertFromPixel({ xAxisIndex: index }, position[0]);
      const { points, start, end, zoom } = latest.current;
      const sample = nearestSample(points, Number(time));
      const first = zoom ? start + (end - start) * (zoom[0] / 100) : start;
      const last = zoom ? start + (end - start) * (zoom[1] / 100) : end;
      return sample && sample.time >= first && sample.time <= last ? sample.time : null;
    }

    surface.on('mousemove', (event) => {
      if (latest.current.pinned) return;
      pointer = [event.offsetX, event.offsetY];
      if (!hoverFrame) {
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = 0;
          if (!latest.current.pinned) latest.current.onHover(pointer && timeAt(pointer));
        });
      }
    });
    surface.on('globalout', () => {
      pointer = undefined;
      latest.current.onHover(undefined);
    });
    surface.on('click', (event) => {
      const time = timeAt([event.offsetX, event.offsetY]);
      if (time != null) latest.current.onPin(time);
    });
    chart.on('datazoom', () => {
      const zoom = chart.getOption().dataZoom;
      if (!Array.isArray(zoom)) return;
      const { start, end } = zoom[0] as { start: number; end: number };
      latest.current.onZoom([start, end]);
    });

    const size = new ResizeObserver(scheduleDraw);
    size.observe(element);
    const theme = new MutationObserver(scheduleDraw);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-accent'],
    });
    scheduleDraw();
    return () => {
      size.disconnect();
      theme.disconnect();
      cancelAnimationFrame(drawFrame);
      cancelAnimationFrame(hoverFrame);
      redraw.current = undefined;
      showPointer.current = undefined;
      chart.dispose();
    };
  }, []);

  const { plots, points, start, end, detailed, zoom, locale, selectedTime } = props;
  const zoomed = zoom !== undefined;
  useEffect(() => {
    redraw.current?.();
  }, [plots, points, start, end, detailed, zoomed, locale]);
  useEffect(() => {
    showPointer.current?.();
  }, [selectedTime]);

  return <div ref={host} className="monitor-canvas" aria-hidden="true" />;
}
