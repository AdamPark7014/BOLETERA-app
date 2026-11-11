'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.DataTable = DataTable;
const DataTable_module_scss_1 = __importDefault(require('./DataTable.module.scss'));
function DataTable({ columns, data, keyField = 'id' }) {
  return (
    <div className={DataTable_module_scss_1.default.wrap}>
      <table className={DataTable_module_scss_1.default.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={String(row[keyField])}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(row) : String(row[c.key] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
//# sourceMappingURL=DataTable.js.map
