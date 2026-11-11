'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.Card = Card;
const Card_module_scss_1 = __importDefault(require('./Card.module.scss'));
function Card({ children, className = '' }) {
  return <div className={`${Card_module_scss_1.default.card} ${className}`}>{children}</div>;
}
//# sourceMappingURL=Card.js.map
