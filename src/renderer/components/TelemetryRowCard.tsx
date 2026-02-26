import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';

export type TelemetryRowCardProps = {
    title: string;
    currentValue: number | null | undefined;
    unit: string;
    icon?: React.ReactNode;
    data: { ts: Date; value: number }[];
    metricType?: 'voltage' | 'frequency' | 'current' | 'percent' | 'temperature' | 'default';
    nominalValue?: number;
    applyMovingAverage?: boolean;
    minAggregate?: number;
    maxAggregate?: number;
    windowStart?: Date;
    windowEnd?: Date;
};

function calculateSMA(data: { ts: Date; value: number }[], windowSize: number): { ts: Date; value: number }[] {
    return data.map((point, idx, arr) => {
        let sum = 0;
        let count = 0;
        for (let i = Math.max(0, idx - windowSize + 1); i <= idx; i++) {
            sum += arr[i].value;
            count++;
        }
        return { ts: point.ts, value: count > 0 ? Number((sum / count).toFixed(2)) : point.value };
    });
}

function calculateGapThresholdMs(data: { ts: Date; value: number }[]): number {
    if (data.length < 3) {
        return 2 * 60 * 1000;
    }

    const diffs: number[] = [];
    for (let i = 1; i < data.length; i++) {
        const delta = data[i].ts.getTime() - data[i - 1].ts.getTime();
        if (delta > 0) {
            diffs.push(delta);
        }
    }

    if (diffs.length === 0) {
        return 2 * 60 * 1000;
    }

    const sorted = diffs.sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];

    // Adapt to downsampled ranges, but keep a minimum floor for short-range windows.
    return Math.max(2 * 60 * 1000, median * 4);
}

function createGapMarkAreaPieces(
    data: { ts: Date; value: number }[],
    gapThresholdMs: number,
    isDark: boolean,
    windowStartMs?: number,
    windowEndMs?: number
) {
    const gapColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pieces: any[] = [];

    const hasWindow =
        typeof windowStartMs === 'number' &&
        typeof windowEndMs === 'number' &&
        Number.isFinite(windowStartMs) &&
        Number.isFinite(windowEndMs) &&
        windowEndMs > windowStartMs;

    if (hasWindow && data.length === 0) {
        pieces.push([
            { xAxis: windowStartMs, itemStyle: { color: gapColor } },
            { xAxis: windowEndMs }
        ]);
        return pieces;
    }

    if (data.length === 0) {
        return pieces;
    }

    if (hasWindow) {
        const firstTs = data[0].ts.getTime();
        if (firstTs - (windowStartMs as number) > gapThresholdMs) {
            pieces.push([
                { xAxis: windowStartMs, itemStyle: { color: gapColor } },
                { xAxis: firstTs }
            ]);
        }
    }

    let lastTs = data[0].ts.getTime();
    for (let i = 1; i < data.length; i++) {
        const currTs = data[i].ts.getTime();
        if (currTs - lastTs > gapThresholdMs) {
            pieces.push([
                { xAxis: lastTs, itemStyle: { color: gapColor } },
                { xAxis: currTs }
            ]);
        }
        lastTs = currTs;
    }

    if (hasWindow) {
        const lastPointTs = data[data.length - 1].ts.getTime();
        if ((windowEndMs as number) - lastPointTs > gapThresholdMs) {
            pieces.push([
                { xAxis: lastPointTs, itemStyle: { color: gapColor } },
                { xAxis: windowEndMs }
            ]);
        }
    }

    return pieces;
}

function formatXAxisLabel(timestamp: number, spanMs: number): string {
    const date = new Date(timestamp);
    if (spanMs >= 24 * 60 * 60 * 1000) {
        return date.toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function TelemetryRowCard({
    title,
    currentValue,
    unit,
    icon,
    data,
    metricType = 'default',
    nominalValue,
    applyMovingAverage,
    minAggregate,
    maxAggregate,
    windowStart,
    windowEnd
}: TelemetryRowCardProps) {
    const { t } = useTranslation();
    const isDark = document.documentElement.classList.contains('dark');
    const colorLine = isDark ? '#10a37f' : '#059669';
    const colorArea = isDark ? 'rgba(16, 163, 127, 0.15)' : 'rgba(16, 163, 127, 0.1)';

    const chartOptions = useMemo(() => {
        const windowStartMs = windowStart?.getTime();
        const windowEndMs = windowEnd?.getTime();
        const hasWindow =
            typeof windowStartMs === 'number' &&
            typeof windowEndMs === 'number' &&
            Number.isFinite(windowStartMs) &&
            Number.isFinite(windowEndMs) &&
            windowEndMs > windowStartMs;

        const sourceData = hasWindow
            ? data.filter(d => {
                const ts = d.ts.getTime();
                return ts >= (windowStartMs as number) && ts <= (windowEndMs as number);
            })
            : data;

        const movingAverageWindow = metricType === 'temperature' ? 7 : 5;
        const renderData = applyMovingAverage && sourceData.length > 0
            ? calculateSMA(sourceData, movingAverageWindow)
            : sourceData;

        let min: number | string = 'dataMin';
        let max: number | string = 'dataMax';
        let yAxisScale = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let markArea: any = undefined;

        const validData = renderData.filter(d => d.value !== null);
        const lastVal = validData.length > 0 ? validData[validData.length - 1].value : 0;

        if (metricType === 'percent') {
            min = 0;
            max = 100;
            yAxisScale = false;
        } else if (metricType === 'voltage') {
            if (nominalValue) {
                min = nominalValue * 0.8;
                max = nominalValue * 1.2;
                yAxisScale = false;
                markArea = {
                    itemStyle: { color: isDark ? 'rgba(52, 211, 153, 0.15)' : 'rgba(52, 211, 153, 0.2)' },
                    data: [
                        [{ yAxis: nominalValue * 0.9 }, { yAxis: nominalValue * 1.1 }]
                    ]
                };
            } else {
                const avg = validData.length > 0 ? validData.reduce((a, b) => a + b.value, 0) / validData.length : lastVal;
                const center = avg > 0 ? avg : 12;
                min = Number((center * 0.9).toFixed(1));
                max = Number((center * 1.1).toFixed(1));
                yAxisScale = false;
            }
        } else if (metricType === 'frequency') {
            const nominal = nominalValue ?? (lastVal > 55 ? 60 : 50);
            const range = nominal * 0.01;
            min = nominal - Math.max(range * 2, 1);
            max = nominal + Math.max(range * 2, 1);
            yAxisScale = false;
            markArea = {
                itemStyle: { color: isDark ? 'rgba(52, 211, 153, 0.15)' : 'rgba(52, 211, 153, 0.2)' },
                data: [
                    [{ yAxis: nominal - range }, { yAxis: nominal + range }]
                ]
            };
        } else if (metricType === 'temperature') {
            const observedMin = Number.isFinite(minAggregate) ? (minAggregate as number) : (
                validData.length > 0 ? Math.min(...validData.map(d => d.value)) : undefined
            );
            const observedMax = Number.isFinite(maxAggregate) ? (maxAggregate as number) : (
                validData.length > 0 ? Math.max(...validData.map(d => d.value)) : undefined
            );

            if (observedMin !== undefined && observedMax !== undefined) {
                min = observedMin - 5;
                max = observedMax + 5;
                yAxisScale = false;
            }
        }

        const gapThresholdMs = calculateGapThresholdMs(renderData);
        const gapPieces = createGapMarkAreaPieces(
            renderData,
            gapThresholdMs,
            isDark,
            hasWindow ? windowStartMs : undefined,
            hasWindow ? windowEndMs : undefined
        );

        if (gapPieces.length > 0) {
            if (!markArea) {
                markArea = { data: gapPieces };
            } else {
                markArea.data = [...markArea.data, ...gapPieces];
            }
        }

        const timeSpanMs = hasWindow
            ? (windowEndMs as number) - (windowStartMs as number)
            : renderData.length > 1
                ? renderData[renderData.length - 1].ts.getTime() - renderData[0].ts.getTime()
                : 0;

        return {
            animation: false, // For performance on many rows
            tooltip: {
                show: true,
                trigger: 'axis',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter: (params: any) => {
                    if (!params || !params.length) return '';
                    const timeObj = new Date(params[0].value[0]);
                    const time = timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const val = params[0].value[1].toFixed(1);
                    return `<div><strong>${time}</strong><br/>${val}${unit}</div>`;
                },
                axisPointer: { type: 'line' },
                backgroundColor: 'var(--color-bg-card)',
                borderColor: 'var(--color-border)',
                textStyle: { color: 'var(--color-text)', fontSize: 12 },
                padding: [4, 8],
            },
            grid: {
                left: 10,
                right: 10,
                top: 10,
                bottom: 24,
                containLabel: false,
            },
            xAxis: {
                type: 'time',
                show: true,
                boundaryGap: false,
                splitNumber: 4,
                min: hasWindow ? windowStartMs : undefined,
                max: hasWindow ? windowEndMs : undefined,
                axisLabel: {
                    color: 'var(--color-text-dim)',
                    fontSize: 10,
                    hideOverlap: true,
                    margin: 8,
                    formatter: (value: number) => formatXAxisLabel(Number(value), timeSpanMs)
                },
                axisLine: {
                    show: false
                },
                axisTick: {
                    show: false
                },
                splitLine: {
                    show: false
                }
            },
            yAxis: {
                type: 'value',
                show: false,
                scale: yAxisScale,
                min,
                max,
            },
            series: [
                {
                    data: renderData.map(d => [d.ts.getTime(), d.value]),
                    type: 'line',
                    smooth: true,
                    symbol: 'none',
                    lineStyle: {
                        color: colorLine,
                        width: 2,
                    },
                    markArea,
                    areaStyle: {
                        color: {
                            type: 'linear',
                            x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [
                                { offset: 0, color: colorArea },
                                { offset: 1, color: isDark ? 'rgba(16, 163, 127, 0)' : 'rgba(5, 150, 105, 0)' }
                            ]
                        }
                    },
                }
            ]
        };
    }, [data, metricType, colorLine, colorArea, isDark, unit, nominalValue, applyMovingAverage, windowStart, windowEnd]);

    return (
        <div className="telemetry-row-card">
            <div className="telemetry-row-info">
                <div className="telemetry-row-header">
                    {icon && <span className="telemetry-icon">{icon}</span>}
                    <span className="telemetry-title">{title}</span>
                </div>
                <div className="telemetry-value">
                    {currentValue !== null && currentValue !== undefined ? currentValue.toFixed(1) : '--'}
                    <span className="telemetry-unit">{unit}</span>
                </div>
                {(minAggregate !== undefined || maxAggregate !== undefined) && (
                    <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {minAggregate !== undefined && <span title={t('telemetryRow.minimum')}>▼ {minAggregate.toFixed(1)}{unit}</span>}
                        {maxAggregate !== undefined && <span title={t('telemetryRow.maximum')}>▲ {maxAggregate.toFixed(1)}{unit}</span>}
                    </div>
                )}
            </div>
            <div className="telemetry-row-chart">
                <ReactECharts
                    option={chartOptions}
                    style={{ height: '78px', width: '100%' }}
                    lazyUpdate={true}
                    replaceMerge={['series']}
                />
            </div>
        </div>
    );
}
