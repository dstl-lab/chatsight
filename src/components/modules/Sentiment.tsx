import "./Sentiment.css";
import "./ModuleResize.css";
import { useModuleResize } from "./useModuleResize";
import { Chart, type AxisOptions } from "react-charts";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/apiClient";
import { BallTriangle } from "react-loader-spinner";

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
  mode: "aggregate" | "per-sentence" | "time";
  visibleSentiments?: Set<string>;
}

type SentimentData = { category: string; value: number; sentence?: string };

type SentimentPoint = {
  order: number;
  time: Date;
  value: number;
};

type SentimentSeries = {
  label: string;
  data: SentimentData[] | SentimentPoint[];
};

type SentimentResult = {
  sentence: string;
  sentiment: Array<{ label: string; score: number }>;
};

export const SENTIMENT_COLORS: Record<string, string> = {
  anger: "#f4a6a6",
  surprise: "#fcd9a4",
  joy: "#a7e9af",
  sadness: "#a5c9f7",
  fear: "#c4b5fd",
  disgust: "#d9f99d",
  neutral: "#c4b8b8",
};
const DEFAULT_SERIES_COLOR = "#cbd5e1";

export function Sentiment({
  onClose,
  onResize,
  colSpan = 2,
  rowSpan = 1,
  data,
  sharedMessages,
  RAW_SCORE_THREHOLD = 0.5,
  mode = "time",
  visibleSentiments,
}: SentimentProps) {
  const [isLoading, setIsLoading] = useState(false);

  const primaryAxis = useMemo(
    (): AxisOptions<any> => ({
      getValue: (d: any) => (mode === "time" ? d.order : d.category), // use order, not Date
      scaleType: mode === "time" ? "band" : undefined, // categorical positions
    }),
    [mode],
  );

  const secondaryAxes = useMemo(
    (): AxisOptions<any>[] => [
      {
        getValue: (d: any) => d.value,
        elementType: "bar",
        stacked: true,
      },
    ],
    [],
  );

  const getSeriesStyle = useMemo(
    () => (series: { label: string }) => {
      const color =
        SENTIMENT_COLORS[series.label] ?? DEFAULT_SERIES_COLOR;
      return { color, fill: color };
    },
    [],
  );

  const { moduleRef, handleResizeStart, resizeHandles } = useModuleResize({
    colSpan,
    rowSpan,
    onResize,
  });

  const [sentimentResults, setSentimentResults] = useState<
    SentimentResult[] | null
  >(null);

  const chartData = useMemo((): SentimentSeries[] | undefined => {
    if (!sentimentResults || sentimentResults.length <= 2) return data;

    if (mode === "time") {
      // Indices in sharedMessages where role === STUDENT (same order as sentimentResults)
      const studentOriginalIndices = sharedMessages
        .map((msg, idx) => ({ msg, idx }))
        .filter(({ msg }) => msg.role === "STUDENT")
        .map(({ idx }) => idx);

      // Sort by timestamp; dedupe by original index so we don't double-count the same message
      const seenIdx = new Set<number>();
      const timedMessages = sharedMessages
        .map((msg, idx) => ({ msg, idx }))
        .filter(({ msg }) => msg.role === "STUDENT" && msg.timestamp)
        .filter(({ idx }) => {
          if (seenIdx.has(idx)) return false;
          seenIdx.add(idx);
          return true;
        })
        .map(({ msg, idx }) => {
          const ts = msg.timestamp!;
          const time = new Date(ts.substring(1, ts.length - 1));
          return { idx, time };
        })
        .sort((a, b) => a.time.getTime() - b.time.getTime());

      // 2) Map original index -> order (0,1,2,…) based on timestamp
      const orderByIndex = new Map<number, number>();
      timedMessages.forEach(({ idx }, order) => {
        orderByIndex.set(idx, order);
      });

      // 3) Build raw points per category (order -> value)
      const byCategory = new Map<string, Map<number, number>>();
      const timeByOrder = new Map<number, Date>();
      timedMessages.forEach(({ time }, order) => {
        timeByOrder.set(order, time);
      });

      // sentimentResults[i] corresponds to the i-th student message → original index = studentOriginalIndices[i]
      sentimentResults.forEach((r, idx) => {
        const originalIdx = studentOriginalIndices[idx];
        if (originalIdx === undefined) return;
        const order = orderByIndex.get(originalIdx);
        if (order == null) return;
        const time = timeByOrder.get(order);
        if (!time) return;

        for (const s of r.sentiment) {
          let points = byCategory.get(s.label);
          if (!points) {
            points = new Map<number, number>();
            byCategory.set(s.label, points);
          }
          points.set(order, s.score * 100);
        }
      });

      // 4) One datum per order for every series (value 0 where missing) so stacking aligns
      const numOrders = timedMessages.length;
      const timeEntries = Array.from(byCategory.entries()).filter(
        ([label]) => !visibleSentiments || visibleSentiments.has(label),
      );
      return timeEntries.map(([label, orderToValue]) => ({
        label,
        data: Array.from({ length: numOrders }, (_, order): SentimentPoint => ({
          order,
          value: orderToValue.get(order) ?? 0,
          time: timeByOrder.get(order)!,
        })),
      }));
    }
    if (mode === "aggregate") {
      const byCategory = new Map<string, number>();
      for (const r of sentimentResults) {
        for (const s of r.sentiment) {
          const current = byCategory.get(s.label) ?? 0;
          byCategory.set(s.label, current + s.score);
        }
      }
      const aggregated: SentimentData[] = Array.from(byCategory.entries())
        .filter(
          ([category]) => !visibleSentiments || visibleSentiments.has(category),
        )
        .map(([category, value]) => ({ category, value }));
      return [{ label: "Aggregate", data: aggregated }];
    }
    return sentimentResults.map((r) => ({
      label:
        r.sentence.length > 40
          ? r.sentence.slice(0, 40).trim() + "…"
          : r.sentence,
      data: r.sentiment
        .filter(
          (s) =>
            s.score > RAW_SCORE_THREHOLD &&
            (!visibleSentiments || visibleSentiments.has(s.label)),
        )
        .map((s) => ({ category: s.label, value: s.score })),
    }));
  }, [
    sentimentResults,
    mode,
    data,
    RAW_SCORE_THREHOLD,
    sharedMessages,
    visibleSentiments,
  ]);

  const fetchSentiment = async (sentences: string[], signal?: AbortSignal) => {
    if (sentences.length === 0) return [];
    return apiClient.getSentiment(sentences, signal);
  };

  useEffect(() => {
    setIsLoading(true);
    const controller = new AbortController();
    const studentContents = sharedMessages
      .filter((msg) => msg.role === "STUDENT")
      .map((msg) => msg.content);
    if (studentContents.length === 0) {
      setSentimentResults(null);
      setIsLoading(false);
      return;
    }
    fetchSentiment(studentContents, controller.signal)
      .then((results) => {
        setSentimentResults(results.length > 0 ? results : null);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") console.error(err);
      })
      .finally(() => setIsLoading(false));
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
        {!isLoading ? (
          <div className="sentiment-chart">
            {chartData ? (
              <Chart
                options={{
                  data: chartData,
                  primaryAxis,
                  secondaryAxes,
                  getSeriesStyle,
                }}
              />
            ) : (
              <div className="sentiment-empty">
                <p className="sentiment-empty-text">Select a Conversation</p>
                <p className="sentiment-empty-hint">
                  Choose a conversation from the sidebar to see sentiment
                  analysis.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="sentiment-loading">
            <BallTriangle
              height={80}
              width={80}
              radius={5}
              color="#4fa94d"
              ariaLabel="ball-triangle-loading"
              wrapperStyle={{}}
              wrapperClass="sentiment-loading-spinner"
              visible={true}
            />
            <p className="sentiment-loading-text">Analyzing sentiment…</p>
          </div>
        )}
      </div>
    </div>
  );
}
