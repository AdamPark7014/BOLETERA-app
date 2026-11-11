'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.Badge = Badge;
const Badge_module_scss_1 = __importDefault(require('./Badge.module.scss'));
function Badge({ children, variant = 'default' }) {
  return (
    <span
      className={`${Badge_module_scss_1.default.badge} ${Badge_module_scss_1.default[variant]}`}
    >
      {children}
    </span>
  );
}
//# sourceMappingURL=Badge.js.map
