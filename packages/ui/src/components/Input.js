'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.Input = Input;
const Input_module_scss_1 = __importDefault(require('./Input.module.scss'));
function Input({ label, error, className = '', id, ...props }) {
  const inputId = id ?? label?.toLowerCase().replace(/\s/g, '-');
  return (
    <div className={Input_module_scss_1.default.wrapper}>
      {label && (
        <label htmlFor={inputId} className={Input_module_scss_1.default.label}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`${Input_module_scss_1.default.input} ${error ? Input_module_scss_1.default.error : ''} ${className}`}
        {...props}
      />
      {error && <span className={Input_module_scss_1.default.errorText}>{error}</span>}
    </div>
  );
}
//# sourceMappingURL=Input.js.map
