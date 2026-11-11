'use strict';
'use client';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.Modal = Modal;
const Modal_module_scss_1 = __importDefault(require('./Modal.module.scss'));
function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className={Modal_module_scss_1.default.overlay} onClick={onClose} role="presentation">
      <div
        className={Modal_module_scss_1.default.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        {title && <h2 className={Modal_module_scss_1.default.title}>{title}</h2>}
        {children}
      </div>
    </div>
  );
}
//# sourceMappingURL=Modal.js.map
