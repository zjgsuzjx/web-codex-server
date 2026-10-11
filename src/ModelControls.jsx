import Select from './Select';
import { availableModels, compatibleEffort, modelOptions, reasoningEfforts, selectedModel } from './model-options';

export default function ModelControls({ models, value, onChange, disabled }) {
  const choices = availableModels(models), model = selectedModel(choices, value.model);
  const efforts = reasoningEfforts(model), options = modelOptions(models, value.model);
  return <div className="model-controls">
    <label>模型<Select aria-label="模型" value={value.model} disabled={disabled} onChange={e => {
      const next = selectedModel(choices, e.target.value);
      onChange({ ...value, model: e.target.value, effort: compatibleEffort(next, value.effort) });
    }}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>
    <label>推理强度<Select aria-label="推理强度" value={value.effort} disabled={disabled || !efforts.length} onChange={e => onChange({ ...value, effort: e.target.value })}>
      {!efforts.includes(value.effort) && <option value={value.effort} disabled>{efforts.length ? value.effort : '使用模型默认值'}</option>}
      {efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}
    </Select></label>
  </div>;
}
