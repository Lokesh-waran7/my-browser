// Unit Test for Conversation History Sanitizer
const assert = require('assert');
const { sanitizeHistory, isErrorOrPlaceholder } = require('../src/main/ai/historySanitizer');

console.log('--- Running History Sanitizer Unit Tests ---');

// Test 1: Drops empty messages and whitespace-only
{
  const input = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: '' },
    { role: 'assistant', content: '   \n  \t  ' },
    { role: 'assistant', content: 'hi there' },
  ];
  const output = sanitizeHistory(input);
  assert.strictEqual(output.length, 2, 'Should drop empty assistant messages');
  assert.strictEqual(output[0].role, 'user');
  assert.strictEqual(output[0].content, 'hello');
  assert.strictEqual(output[1].role, 'model');
  assert.strictEqual(output[1].content, 'hi there');
  console.log('✓ Test 1 Passed: Drops empty and whitespace-only messages');
}

// Test 2: Drops error bubbles and placeholders
{
  const input = [
    { role: 'user', content: 'check this code' },
    { role: 'assistant', content: '⚠️ Error: Request timed out' },
    { role: 'assistant', content: 'Error: 400 Invalid argument' },
    { role: 'assistant', content: 'No response received from the model. Please verify prompt or retry.' },
    { role: 'assistant', content: '(No response received from model. Please verify your API key or prompt)' },
    { role: 'assistant', content: 'Quota Limit Reached: 429' },
    { role: 'user', content: 'trying again' },
    { role: 'assistant', content: 'Here is the fixed code.' },
  ];
  const output = sanitizeHistory(input);
  assert.strictEqual(output.length, 2, 'Should drop all error/placeholder messages and merge users');
  assert.strictEqual(output[0].role, 'user');
  assert.strictEqual(output[0].content, 'check this code\n\ntrying again');
  assert.strictEqual(output[1].role, 'model');
  assert.strictEqual(output[1].content, 'Here is the fixed code.');
  console.log('✓ Test 2 Passed: Drops error bubbles and placeholder messages');
}

// Test 3: Merges repeated roles
{
  const input = [
    { role: 'user', content: 'first prompt' },
    { role: 'user', content: 'second prompt' },
    { role: 'user', content: 'third prompt' },
    { role: 'assistant', content: 'reply one' },
    { role: 'assistant', content: 'reply two' },
    { role: 'user', content: 'fourth prompt' },
  ];
  const output = sanitizeHistory(input);
  assert.strictEqual(output.length, 3, 'Consecutive same-role messages should be merged');
  assert.strictEqual(output[0].role, 'user');
  assert.strictEqual(output[0].content, 'first prompt\n\nsecond prompt\n\nthird prompt');
  assert.strictEqual(output[1].role, 'model');
  assert.strictEqual(output[1].content, 'reply one\n\nreply two');
  assert.strictEqual(output[2].role, 'user');
  assert.strictEqual(output[2].content, 'fourth prompt');
  console.log('✓ Test 3 Passed: Merges repeated roles into single turns');
}

// Test 4: Drops leading model messages
{
  const input = [
    { role: 'assistant', content: 'I am ready to help.' },
    { role: 'model', content: 'How are you?' },
    { role: 'user', content: 'What is Node?' },
    { role: 'assistant', content: 'Node is a JavaScript runtime.' },
  ];
  const output = sanitizeHistory(input);
  assert.strictEqual(output.length, 2, 'Should drop leading assistant/model messages');
  assert.strictEqual(output[0].role, 'user');
  assert.strictEqual(output[0].content, 'What is Node?');
  assert.strictEqual(output[1].role, 'model');
  assert.strictEqual(output[1].content, 'Node is a JavaScript runtime.');
  console.log('✓ Test 4 Passed: Drops leading assistant/model messages');
}

// Test 5: Strict alternation guaranteed
{
  const input = [
    { role: 'user', content: 'U1' },
    { role: 'user', content: 'U2' },
    { role: 'assistant', content: 'A1' },
    { role: 'assistant', content: 'A2' },
    { role: 'user', content: 'U3' },
    { role: 'assistant', content: 'A3' },
  ];
  const output = sanitizeHistory(input);
  for (let i = 0; i < output.length; i++) {
    const expectedRole = i % 2 === 0 ? 'user' : 'model';
    assert.strictEqual(output[i].role, expectedRole, `Message at ${i} must have role ${expectedRole}`);
  }
  console.log('✓ Test 5 Passed: Strictly alternates user and model');
}

// Test 6: Length capping ensures start with user
{
  const input = [];
  for (let i = 1; i <= 15; i++) {
    input.push({ role: 'user', content: `User ${i}` });
    input.push({ role: 'assistant', content: `Assistant ${i}` });
  }
  const max = 8;
  const output = sanitizeHistory(input, max);
  assert.ok(output.length <= max, `Length ${output.length} should be <= ${max}`);
  assert.strictEqual(output[0].role, 'user', 'Capped history must still start with user');
  for (let i = 0; i < output.length; i++) {
    assert.strictEqual(output[i].role, i % 2 === 0 ? 'user' : 'model');
  }
  console.log('✓ Test 6 Passed: Length capping retains user-start constraint');
}

// Test 7: Handles empty or invalid inputs gracefully
{
  assert.deepStrictEqual(sanitizeHistory([]), []);
  assert.deepStrictEqual(sanitizeHistory(null), []);
  assert.deepStrictEqual(sanitizeHistory(undefined), []);
  assert.deepStrictEqual(sanitizeHistory([null, {}, { role: 'user', content: '' }]), []);
  console.log('✓ Test 7 Passed: Gracefully handles empty and malformed inputs');
}

console.log('--- ALL HISTORY SANITIZER TESTS PASSED ---');
