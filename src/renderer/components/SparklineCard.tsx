import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

export interface SparklineCardProps {
    title: string;
    currentValue: number | string | null;
    unit?: string;
    icon?: React.ReactNode;
    data: number[];
    color?: string;
    metricType?: 'voltage' | 'frequency' | 'current' | 'percent' | 'default';
    nominalValue?: number;
    applyMovingAverage?: boolean;
    tolerancePosPct?: number;
    toleranceNegPct?: number;
}

function calculateSMA(data: number[], windowSize: number): number[] {
    return data.map((val, idx, arr) => {
        let sum = 0;
        let count = 0;
        for (let i = Math.max(0, idx - windowSize + 1); i <= idx; i++) {
            sum += arr[i];
            count++;
        }
        return count > 0 ? Number((sum / count).toFixed(2)) : val;
    });
}

export function SparklineCard({
    title,
    currentValue,
    unit = '',
    icon,
    data,
    color = '#10a37f', // Default primary color
    metricType = 'default',
    nominalValue,
    applyMovingAverage = false,
    tolerancePosPct,
    toleranceNegPct,
}: SparklineCardProps) {
    const chartOptions = useMemo(() => {
        const renderData = applyMovingAverage ? calculateSMA(data, 5) : data;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let yAxis: any = {
            type: 'value',
            show: false,
            scale: true,
            boundaryGap: ['20%', '20%'],
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let markArea: any = undefined;

        const validData = renderData.filter(d => d !== null);
        const lastVal = validData.length > 0 ? validData[validData.length - 1] : 0;

        if (metricType === 'voltage') {
            if (nominalValue) {
                const posPct = (tolerancePosPct ?? 10) / 100;
                const negPct = (toleranceNegPct ?? 10) / 100;
                yAxis = {
                    type: 'value',
                    show: false,
                    scale: false,
                    min: nominalValue * (1 - negPct - 0.1),
                    max: nominalValue * (1 + posPct + 0.1),
                };
                markArea = {
                    itemStyle: { color: 'rgba(52, 211, 153, 0.2)' },
                    data: [
                        [
                            { yAxis: nominalValue * (1 - negPct) },
                            { yAxis: nominalValue * (1 + posPct) }
                        ]
                    ]
                };
            } else {
                // Battery voltage fallback: +-10% relative padding around average
                const avg = validData.length > 0 ? validData.reduce((a, b) => a + b, 0) / validData.length : lastVal;
                const center = avg > 0 ? avg : 220; // Fallback to 220 if 0
                yAxis = {
                    type: 'value',
                    show: false,
                    scale: false,
                    min: Number((center * 0.9).toFixed(1)),
                    max: Number((center * 1.1).toFixed(1)),
                };
            }
        } else if (metricType === 'frequency') {
            const nominal = nominalValue ?? (lastVal > 55 ? 60 : 50);
            const posPct = (tolerancePosPct ?? 1) / 100;
            const negPct = (toleranceNegPct ?? 1) / 100;
            const rangePos = nominal * posPct;
            const rangeNeg = nominal * negPct;
            yAxis = {
                type: 'value',
                show: false,
                scale: false,
                min: nominal - Math.max(rangeNeg * 2, 1),
                max: nominal + Math.max(rangePos * 2, 1),
            };
            markArea = {
                itemStyle: { color: 'rgba(52, 211, 153, 0.2)' },
                data: [
                    [
                        { yAxis: nominal - rangeNeg },
                        { yAxis: nominal + rangePos }
                    ]
                ]
            };
        }

        return {
            animation: false, // Disable animation for smoother live updates
            tooltip: {
                show: true,
                trigger: 'axis',
                formatter: `{c}${unit}`,
                axisPointer: { type: 'none' },
                backgroundColor: 'var(--color-bg-card)',
                borderColor: 'var(--color-border)',
                textStyle: { color: 'var(--color-text)', fontSize: 12 },
                padding: [4, 8],
            },
            grid: {
                top: 5,
                bottom: 5,
                left: 5,
                right: 5,
                containLabel: false,
            },
            xAxis: {
                type: 'category',
                show: false,
                boundaryGap: false,
                data: renderData.map((_, i) => i),
            },
            yAxis,
            series: [
                {
                    data: renderData,
                    type: 'line',
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 4,
                    showSymbol: false, // Only show on hover
                    markArea,
                    lineStyle: {
                        color: color,
                        width: 2,
                    },
                    itemStyle: {
                        color: color,
                    },
                    areaStyle: {
                        color: {
                            type: 'linear',
                            x: 0,
                            y: 0,
                            x2: 0,
                            y2: 1,
                            colorStops: [
                                { offset: 0, color: `${color}40` }, // 25% opacity
                                { offset: 1, color: `${color}00` }, // 0% opacity
                            ],
                        },
                    },
                },
            ],
        };
    }, [data, color, unit, metricType, nominalValue]);

    return (
        <div className="sparkline-card">
            <div className="sparkline-header">
                <span className="sparkline-title">{title}</span>
            </div>
            <div className="sparkline-body">
                <div className="sparkline-metric">
                    {icon && <span className="sparkline-icon">{icon}</span>}
                    <span className="sparkline-value">
                        {currentValue !== null ? currentValue : '--'}
                    </span>
                    {currentValue !== null && unit && (
                        <span className="sparkline-unit">{unit}</span>
                    )}
                </div>
                <div className="sparkline-chart-container">
                    <ReactECharts
                        option={chartOptions}
                        style={{ height: '100%', width: '100%' }}
                        opts={{ renderer: 'svg' }}
                    />
                </div>
            </div>
        </div>
    );
}
