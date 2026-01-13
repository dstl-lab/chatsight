import { useState, useRef, useEffect } from 'react';
import { apiClient } from '../services/apiClient';
import dstlLogo from '../assets/dstl-logo.png';
import './Header.css';

export function Header({ onFileUpload }: { onFileUpload?: () => void }) {
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(event.target as Node)) {
        setIsFileMenuOpen(false);
      }
    };

    if (isFileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isFileMenuOpen]);

  const handleFileClick = () => {
    setIsFileMenuOpen(!isFileMenuOpen);
  };

  const handleMenuItemClick = (action: string) => {
    setIsFileMenuOpen(false);

    if (action === 'add-new-file') {
      fileInputRef.current?.click();
    } else if (action === 'export-template') {
      console.log('Export template'); // PLACEHOLDER
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];
  
      const MAX_FILE_SIZE = 10 * 1024 * 1024;
      if (file.size > MAX_FILE_SIZE) {
        alert(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds the maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB. Please choose a smaller file.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      
      try {
        await apiClient.uploadFile(file);
      } catch (error) {
        console.error('Failed to upload file:', error);
        alert('Failed to upload file. Please try again.');
      } finally {
        onFileUpload?.();
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    }
  };

  return (
    <>
      <div className="header">
        <div className="header-left">
          <div className="header-menu-item" ref={fileMenuRef}>
            <p
              className={`header-menu-trigger ${isFileMenuOpen ? 'active' : ''}`}
              onClick={handleFileClick}
            >
              File
            </p>
            {isFileMenuOpen && (
              <div className="header-dropdown">
                <div
                  className="header-dropdown-item"
                  onClick={() => handleMenuItemClick('add-new-file')}
                >
                  add new file
                </div>
                <div
                  className="header-dropdown-item"
                  onClick={() => handleMenuItemClick('export-template')}
                >
                  export current template
                </div>
              </div>
            )}
          </div>
          <p>Help</p>
          <p>Documentation</p>
          <p>Save</p>
        </div>
        <div className="header-center">ChatSight</div>
        <div className="header-right">
          <img src={dstlLogo} alt="DSTL Logo" />
          <p>dstl lab</p>
        </div>
      </div>
      <div className="header-separator" />

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileChange}
        accept=".txt"
      />
    </>
  );
}

