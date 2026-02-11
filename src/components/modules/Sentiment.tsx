import "./Sentiment.css";
import "./ModuleResize.css";
import { useModuleResize } from "./useModuleResize";
import { Chart, type AxisOptions } from 'react-charts';
import { useMemo } from "react";

interface SentimentProps {
  onClose?: () => void;
  onResize?: (newColSpan: number, newRowSpan: number) => void;
  colSpan?: number;
  rowSpan?: number;
  data?: SentimentSeries[];
}

type SentimentData = {category: string, value: number};

type SentimentSeries = {
  label: string;
  data: SentimentData[];
};

const defaultData: SentimentSeries[] = 
[
  {
    label: 'Default Sentiment',
    data: [
      {category: 'Angry', value: 1},
      {category: 'Happy', value: 5},
      {category: 'Neutral', value: 7}
    ]
  }
]

export function Sentiment({
  onClose,
  onResize,
  colSpan = 2,
  rowSpan = 1,
  data = defaultData,
}: SentimentProps) {

  const primaryAxis = useMemo(() : AxisOptions<SentimentData> => ({
    getValue: datum => datum.category,
  }), [])

  const secondaryAxes = useMemo((): AxisOptions<SentimentData>[] => [
    ({
      getValue: datum => datum.value,
      elementType: 'bar',
    })
  ], [])


  const { moduleRef, handleResizeStart, resizeHandles } = useModuleResize({
    colSpan,
    rowSpan,
    onResize,
  });

  return <div className="sentiment-module" ref={moduleRef}>
            {resizeHandles.right && (
                <div
                    className="resize-handle resize-handle-right"
                    onMouseDown={(e) => handleResizeStart(e, 'right')}
                />
            )}
            {resizeHandles.bottom && (
                <div
                    className="resize-handle resize-handle-bottom"
                    onMouseDown={(e) => handleResizeStart(e, 'down')}
                />
            )}
            {resizeHandles.corner && (
                <div
                    className="resize-handle resize-handle-corner"
                    onMouseDown={(e) => handleResizeStart(e, 'corner')}
                />
            )}
            <div className="module-header">
                <h3 className="module-title">Sentiment</h3>
                <button className="close-button" onClick={onClose} aria-label="Close module">
                    x
                </button>
            </div>
            <div className="sentiment-content">
              <div className="sentiment-chart">
                <Chart options={{data, primaryAxis, secondaryAxes}}/>
              </div>
            </div>
        </div>;
}
