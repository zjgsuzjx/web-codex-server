import test from 'node:test';
import assert from 'node:assert/strict';
import { availableModels, compatibleEffort, modelOptions, reasoningEfforts, selectedModel } from '../src/model-options.js';

test('model choices preserve actual capabilities and omit hidden or duplicate models', () => {
  const models = [{ id: 'a', model: 'a', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }, { id: 'duplicate', model: 'a' }, { id: 'hidden', hidden: true }, { displayName: 'invalid' }];
  assert.deepEqual(availableModels(models), [models[0]]);
  assert.equal(selectedModel(models, ''), models[0]);
  assert.equal(selectedModel(models, 'custom-provider'), undefined);
  assert.deepEqual(reasoningEfforts(models[0]), ['low', 'high']);
  assert.deepEqual(reasoningEfforts({ supportedReasoningEfforts: [] }), []);
});

test('shared controls use the same model names and all returned effort levels', () => {
  const models = [{ id: 'sol', displayName: 'GPT-6.1-Sol', isDefault: true, supportedReasoningEfforts: ['low','medium','high','xhigh','max','ultra'].map(reasoningEffort => ({ reasoningEffort })) }];
  assert.deepEqual(modelOptions(models, 'custom'), [{ value: '', label: '服务器默认模型' }, { value: 'sol', label: 'GPT-6.1-Sol' }, { value: 'custom', label: 'custom' }]);
  assert.deepEqual(reasoningEfforts(selectedModel(models, '')), ['low','medium','high','xhigh','max','ultra']);
  assert.equal(compatibleEffort(models[0], 'ultra'), 'ultra');
});

test('switching models keeps a supported effort or falls back to their real default', () => {
  const model = { defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] };
  assert.equal(compatibleEffort(model, 'high'), 'high');
  assert.equal(compatibleEffort(model, 'xhigh'), 'low');
  assert.equal(compatibleEffort({ ...model, defaultReasoningEffort: 'xhigh' }, 'ultra'), 'medium');
  assert.equal(compatibleEffort({ supportedReasoningEfforts: ['none'] }, 'medium'), 'none');
  assert.equal(compatibleEffort({ supportedReasoningEfforts: [] }, 'medium'), 'medium');
});
