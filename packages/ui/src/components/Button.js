'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.Button = Button;
const Button_module_scss_1 = __importDefault(require('./Button.module.scss'));
function Button({ variant = 'primary', size = 'md', className = '', children, ...props }) {
  return (
    <button
      className={`${Button_module_scss_1.default.button} ${Button_module_scss_1.default[variant]} ${Button_module_scss_1.default[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
//# sourceMappingURL=Button.js.map
