import { useState } from 'react';
import './Workspace.css';
import { Messages } from './modules/Messages';

type ModuleType = 'messages' | 'code' | 'notes' | 'chat' | 'wordcloud' | 'sentiment' | null;

export function Workspace() {
  const [gridSlots, setGridSlots] = useState<(ModuleType | null)[]>([
    null, null, null, 
    null, null, null, 
  ]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragEnter = () => {
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
      setDragOverIndex(null);
    }
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDragOverIndex(null);
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }

  const handleDropZoneDragLeave = (e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverIndex(null);
    }
  };

  const handleDrop = (e: React.DragEvent, slotIndex: number) => {
    e.preventDefault();
    setIsDragging(false);
    setDragOverIndex(null);
    const moduleType = e.dataTransfer.getData('moduleType') as ModuleType;

    const normalizedType = moduleType === 'messages' ? 'messages' : moduleType;

    if (normalizedType && gridSlots[slotIndex] === null) {
      setGridSlots(prev => {
        const newSlots = [...prev];
        newSlots[slotIndex] = normalizedType;
        return newSlots;
      });
    }
  };

  const renderModule = (moduleType: ModuleType, index: number) => {
    switch (moduleType) {
      case 'messages':
        return <Messages onClose={() => handleClose(index)} />;
      default:
        return null;
    }
  };

  const handleClose = (position: number) => {
    setGridSlots(prev => {
      const newSlots = [...prev];
      newSlots[position] = null;
      return newSlots;
    });
  };

  return (
    <main 
      className="workspace"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragEnd={handleDragEnd}
    >
      {gridSlots.map((moduleType, index) => (
        <div
          key={index}
          onDragOver={(e) => handleDragOver(e, index)}
          onDragLeave={handleDropZoneDragLeave}
          onDrop={(e) => handleDrop(e, index)}
          className={`${moduleType === null ? 'drop-zone': ''} ${
            isDragging && moduleType === null ? 'dragging-over' : ''
          } ${
            dragOverIndex === index && moduleType === null ? 'drag-over-active' : ''
          }`}
        >
          {renderModule(moduleType, index)}
        </div>
      ))}
    </main>
  );
}