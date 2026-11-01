import type { Settings } from '../../../../shared/contracts/domain.ts';
import type { ProtocolRecord } from '../../../../shared/contracts/protocol.ts';
import Select from '../../../components/ui/Select.tsx';
import {
  availableModels,
  compatibleEffort,
  modelOptions,
  reasoningEfforts,
  selectedModel,
} from '../lib/model-options.ts';
export interface ModelControlsProps {
  models: ProtocolRecord[];
  value: Settings;
  onChange: (value: Settings) => unknown;
  disabled?: boolean;
}

export default function ModelControls({ models, value, onChange, disabled }: ModelControlsProps) {
  const choices = availableModels(models),
    model = selectedModel(choices, value.model);
  const efforts = reasoningEfforts(model),
    options = modelOptions(models, value.model);
  return (
    <div className="model-controls">
      <label>
        模型
        <Select
          aria-label="模型"
          value={value.model}
          disabled={disabled}
          onChange={(e) => {
            const next = selectedModel(choices, (e.target as HTMLInputElement).value);
            onChange({
              ...value,
              model: (e.target as HTMLInputElement).value,
              effort: compatibleEffort(next, value.effort),
            });
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      <label>
        推理强度
        <Select
          aria-label="推理强度"
          value={value.effort}
          disabled={disabled || !efforts.length}
          onChange={(e) => onChange({ ...value, effort: (e.target as HTMLInputElement).value })}
        >
          {!efforts.includes(value.effort) && (
            <option value={value.effort} disabled>
              {efforts.length ? value.effort : '使用模型默认值'}
            </option>
          )}
          {efforts.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
