import "./Sentiment.css";
import "./ModuleResize.css";
import { useModuleResize } from "./useModuleResize";
import { Chart, type AxisOptions } from 'react-charts';
import { useEffect, useMemo } from "react";
import { InferenceClient } from '@huggingface/inference';

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

  const API_KEY = import.meta.env.VITE_HUGGING_FACE_TOKEN;
  const hf = new InferenceClient(API_KEY);
  
  const splitIntoSentences = (text: string): string[] => {
    return text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  };
  
  // Analyze sentiment for each sentence individually
  const fetchSentiment = async (input: string) => {
    const sentences = splitIntoSentences(input);
    const results = await Promise.all(
      sentences.map(async (sentence) => {
        const output = await hf.textClassification({
          model: "j-hartmann/emotion-english-distilroberta-base",
          inputs: sentence,
        });
        return {
          sentence,
          sentiment: output,
        };
      })
    );
    
    console.log("Sentiment analysis for all sentences:", results);
    return results;
  };

  useEffect(() => {
    fetchSentiment("This is a very sad test. This is a very happy test.");
  }, [])


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
