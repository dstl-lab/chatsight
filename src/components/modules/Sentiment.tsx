import "./Sentiment.css";
import "./ModuleResize.css";
import { useModuleResize } from "./useModuleResize";
import { Chart, type AxisOptions } from "react-charts";
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
  RAW_SCORE_THREHOLD?: number;
  isAggregate: boolean;
}

type SentimentData = { category: string; value: number; sentence?: string };

type SentimentSeries = {
  label: string;
  data: SentimentData[];
};

type SentimentResult = { sentence: string; sentiment: Array<{ label: string; score: number }> };

const defaultData: SentimentSeries[] = [
  {
    label: "Default Sentiment",
    data: [
      { category: "Angry", value: 1 },
      { category: "Happy", value: 5 },
      { category: "Neutral", value: 7 },
    ],
  },
];

export function Sentiment({
  onClose,
  onResize,
  colSpan = 2,
  rowSpan = 1,
  data = defaultData,
  sharedMessages,
  RAW_SCORE_THREHOLD=0.5,
  isAggregate=false,
}: SentimentProps) {
  const primaryAxis = useMemo(
    (): AxisOptions<SentimentData> => ({
      getValue: (datum) => datum.category,
    }),
    [],
  );

  const secondaryAxes = useMemo(
    (): AxisOptions<SentimentData>[] => [
      {
        getValue: (datum) => datum.value,
        elementType: "bar",
      },
    ],
    [],
  );

  const { moduleRef, handleResizeStart, resizeHandles } = useModuleResize({
    colSpan,
    rowSpan,
    onResize,
  });

  const [sentimentResults, setSentimentResults] = useState<SentimentResult[] | null>(null);

  const chartData = useMemo((): SentimentSeries[] => {
    if (!sentimentResults?.length) return data;
    if (isAggregate) {
      const byCategory = new Map<string, number>();
      for (const r of sentimentResults) {
        for (const s of r.sentiment) {
          const current = byCategory.get(s.label) ?? 0;
          byCategory.set(s.label, current + s.score);
        }
      }
      const aggregated: SentimentData[] = Array.from(byCategory.entries()).map(
        ([category, value]) => ({ category, value })
      );
      return [{ label: "Aggregate", data: aggregated}];
    }
    return sentimentResults.map((r) => ({
      label:
        r.sentence.length > 40 ? r.sentence.slice(0, 40).trim() + "…" : r.sentence,
      data: r.sentiment
        .filter((s) => s.score > RAW_SCORE_THREHOLD)
        .map((s) => ({ category: s.label, value: s.score })),
    }));
  }, [sentimentResults, isAggregate, data, RAW_SCORE_THREHOLD]);

  const fetchSentiment = async (sentences: string[], signal?: AbortSignal) => {
    if (sentences.length === 0) return [];
    return apiClient.getSentiment(sentences, signal);
  };

  useEffect(() => {
    const controller = new AbortController();
    const studentContents = sharedMessages
      .filter((msg) => msg.role === "STUDENT")
      .map((msg) => msg.content);
    if (studentContents.length === 0) {
      setSentimentResults(null);
      return;
    }
    fetchSentiment(studentContents, controller.signal)
      .then((results) => {
        setSentimentResults(results.length > 0 ? results : null);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") console.error(err);
      });
    return () => controller.abort();
  }, [sharedMessages]);

  return (
    <div className="sentiment-module" ref={moduleRef}>
      {resizeHandles.right && (
        <div
          className="resize-handle resize-handle-right"
          onMouseDown={(e) => handleResizeStart(e, "right")}
        />
      )}
      {resizeHandles.bottom && (
        <div
          className="resize-handle resize-handle-bottom"
          onMouseDown={(e) => handleResizeStart(e, "down")}
        />
      )}
      {resizeHandles.corner && (
        <div
          className="resize-handle resize-handle-corner"
          onMouseDown={(e) => handleResizeStart(e, "corner")}
        />
      )}
      <div className="module-header">
        <h3 className="module-title">Sentiment</h3>
        <button
          className="close-button"
          onClick={onClose}
          aria-label="Close module"
        >
          x
        </button>
      </div>
      <div className="sentiment-content">
        <div className="sentiment-chart">
          <Chart options={{ data: chartData, primaryAxis, secondaryAxes }} />
        </div>
      </div>
    </div>
  );
}
