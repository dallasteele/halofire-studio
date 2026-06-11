import { machineGenerated, verify, isUsable, needsAttention } from '../src/lib/verification-flag';

describe('verification-flag', () => {
  const testNote = 'Test note';
  const testSource = 'Test source';
  const testWho = 'John Doe';
  const testAtIso = '2023-01-01T00:00:00Z';

  describe('machineGenerated', () => {
    it('creates a verification object with status needs-verification', () => {
      const v = machineGenerated(testNote, testSource);
      expect(v.status).toBe('needs-verification');
      expect(v.note).toBe(testNote);
      expect(v.source).toBe(testSource);
      expect(v.verifiedBy).toBeNull();
      expect(v.verifiedAt).toBeNull();
    });
  });

  describe('verify', () => {
    it('returns a new object with status human-verified', () => {
      const v = machineGenerated(testNote, testSource);
      const verified = verify(v, testWho, testAtIso);
      expect(verified.status).toBe('human-verified');
      expect(verified.note).toBe(testNote);
      expect(verified.source).toBe(testSource);
      expect(verified.verifiedBy).toBe(testWho);
      expect(verified.verifiedAt).toBe(testAtIso);
      expect(v).not.toBe(verified);
    });

    it('throws TypeError when who is empty', () => {
      const v = machineGenerated(testNote, testSource);
      expect(() => verify(v, '', testAtIso)).toThrow(TypeError);
    });

    it('throws TypeError when atIso is empty', () => {
      const v = machineGenerated(testNote, testSource);
      expect(() => verify(v, testWho, '')).toThrow(TypeError);
    });

    it('does not mutate input', () => {
      const v = machineGenerated(testNote, testSource);
      const vCopy = { ...v };
      verify(v, testWho, testAtIso);
      expect(v).toEqual(vCopy);
    });
  });

  describe('isUsable', () => {
    it('always returns true', () => {
      const v = machineGenerated(testNote, testSource);
      expect(isUsable(v)).toBe(true);
    });
  });

  describe('needsAttention', () => {
    it('returns true for needs-verification status', () => {
      const v = machineGenerated(testNote, testSource);
      expect(needsAttention(v)).toBe(true);
    });

    it('returns false for human-verified status', () => {
      const v = machineGenerated(testNote, testSource);
      const verified = verify(v, testWho, testAtIso);
      expect(needsAttention(verified)).toBe(false);
    });
  });
});