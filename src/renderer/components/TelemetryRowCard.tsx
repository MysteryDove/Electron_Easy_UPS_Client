import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';

export type TelemetryRowCardProps = {
    title: string;
    currentValue: number | null | undefined;
    unit: string;
    icon?: React.ReactNode;
    data: { ts: Date; value: number }[];
    metricType?: 'voltage' | 'frequency' | 'current' | 'percent' | 'default';
    nominalValue?: number;
    applyMovingAverage?: boolean;
    minAggregate?: number;
    maxAggregate?: number;
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

export function TelemetryRowCard({ title, currentValue, unit, icon, data, metricType = 'default', nominalValue, applyMovingAverage, minAggregate, maxAggregate }: TelemetryRowCardProps) {
    const { t } = useTranslation();
    const isDark = document.documentElement.classList.contains('dark');
    const colorLine = isDark ? '#10a37f' : '#059669';
    const colorArea = isDark ? 'rgba(16, 163, 127, 0.15)' : 'rgba(16, 163, 127, 0.1)';

    const chartOptions = useMemo(() => {
        const renderData = applyMovingAverage && data.length > 0 ? calculateSMA(data, 5) : data;

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
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gapPieces: any[] = [];
        if (renderData && renderData.length > 0) {
            let lastTs = renderData[0].ts.getTime();
            for (let i = 1; i < renderData.length; i++) {
                const currTs = renderData[i].ts.getTime();
                if (currTs - lastTs > 2 * 60 * 1000) {
                    // Gap is larger than 2 minutes. Render a gray background block.
                    gapPieces.push([
                        { xAxis: lastTs, itemStyle: { color: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' } },
                        { xAxis: currTs }
                    ]);
                }
                lastTs = currTs;
            }
        }

        if (gapPieces.length > 0) {
            if (!markArea) {
                markArea = { data: gapPieces };
            } else {
                markArea.data = [...markArea.data, ...gapPieces];
            }
        }

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
                bottom: 10,
                containLabel: false,
            },
            xAxis: {
                type: 'time',
                show: false,
                boundaryGap: false,
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
    }, [data, metricType, colorLine, colorArea, isDark, unit, nominalValue, applyMovingAverage]);

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
                    style={{ height: '60px', width: '100%' }}
                    lazyUpdate={true}
                />
            </div>
        </div>
    );
}
