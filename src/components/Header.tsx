import { useState, useRef, useEffect } from 'react';
import dstlLogo from '../assets/dstl-logo.png';
import './Header.css';

export function Header() {
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);

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

  const handleMenuItemClick = (_action: string) => {
    setIsFileMenuOpen(false);
  }

  return (
    <>
      <div className="header">
        <div className="header-left">
          <div className="header-menu-item" ref={fileMenuRef}>
            <p
              className={`header-menu-trigger ${isFileMenuOpen ? 'active': ''}`}
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
    </>
  );
}

