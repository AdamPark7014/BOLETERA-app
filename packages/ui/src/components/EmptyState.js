'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.EmptyState = EmptyState;
const EmptyState_module_scss_1 = __importDefault(require('./EmptyState.module.scss'));
function EmptyState({ title, description, action }) {
  return (
    <div className={EmptyState_module_scss_1.default.empty}>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className={EmptyState_module_scss_1.default.action}>{action}</div>}
    </div>
  );
}
//# sourceMappingURL=EmptyState.js.map
