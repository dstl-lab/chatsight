import { useState } from 'react';
import { createPortal } from 'react-dom';
import { apiClient } from '../services/apiClient';
import fileIcon from '../assets/files.png'
import txtFile from '../assets/txtfile.png';
import type { FileListItem, FileTreeProps } from '../../shared/types';
import { FileTree } from './OperationsPanel';
import './FileExplorer.css';

type FileExplorerProps = FileTreeProps & {
    onClose?: () => void;
};

export function FileExplorer({ onClose, ...fileTreeProps }: FileExplorerProps) {
    return createPortal(
        <div className="file-explorer-backdrop">
            <div className="file-explorer" onClick={(e) => e.stopPropagation()}>
                <div className="header">
                    <div className="left">
                        <img src={fileIcon}></img>
                        <h1>DIRECTORY</h1>
                    </div>
                    <button onClick={onClose} style={{ 'cursor': 'pointer'}}>x</button>
                </div>
                <div className="section-separator"></div>
                <FileTree {...fileTreeProps} />
            </div>
        </div>,
        document.body
    );
}