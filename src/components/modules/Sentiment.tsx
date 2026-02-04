import "./Sentiment.css";
import "./ModuleResize.css";
import { useModuleResize } from "./useModuleResize";
import { Chart, type AxisOptions } from 'react-charts';
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/apiClient";

interface FileMessageRow {
  id: number;
  role: string | null;
  content: string;
  timestamp: string | null;
  sortOrder: number;
}

interface SentimentProps {
  onClose?: () => void;
  onResize?: (newColSpan: number, newRowSpan: number) => void;
  colSpan?: number;
  rowSpan?: number;
  data?: SentimentSeries[];
  sharedMessages: FileMessageRow[];
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
  sharedMessages,
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

  const [chartData, setChartData] = useState<SentimentSeries[]>(data);

  // Signal here to stop React Strict Mode
  const fetchSentiment = async (sentences: string[], signal?: AbortSignal) => {
    if (sentences.length === 0) return [];
    return apiClient.getSentiment(sentences, signal);
  };

  useEffect(() => {
    const controller = new AbortController();
    const studentContents = sharedMessages
      .filter(msg => msg.role === "STUDENT")
      .map(msg => msg.content);
    fetchSentiment(studentContents, controller.signal)
      .then((results) => {
        if (results.length === 0) {
          setChartData(data);
          return;
        }
        const sentimentData: SentimentData[] = results.flatMap((r) =>
          r.sentiment.map((s) => ({ category: s.label, value: s.score }))
        );
        setChartData([
          { label: "Sentiment", data: sentimentData },
        ]);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") console.error(err);
      });
    return () => controller.abort();
  }, [sharedMessages])


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
                <Chart options={{ data: chartData, primaryAxis, secondaryAxes }} />
              </div>
            </div>
        </div>;
}
