import dstlLogo from '../assets/dstl-logo.png';
import './Header.css';

export function Header() {
  return (
    <>
      <div className="header">
        <div className="header-left">
          <p>File</p>
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

