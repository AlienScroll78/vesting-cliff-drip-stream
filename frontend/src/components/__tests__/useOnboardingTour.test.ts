import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useOnboardingTour,
  buildTourSteps,
  replayTour,
  TOUR_STEPS,
  TOUR_STORAGE_KEY,
  type StreamState,
} from '../../useOnboardingTour';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const STORAGE_KEY = TOUR_STORAGE_KEY;

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

describe('useOnboardingTour', () => {
  it('auto-triggers on first visit when localStorage flag is absent', () => {
    const { result } = renderHook(() => useOnboardingTour());
    expect(result.current.isActive).toBe(true);
  });

  it('does NOT auto-trigger when localStorage completion flag is set', () => {
    localStorageMock.setItem(STORAGE_KEY, 'true');
    const { result } = renderHook(() => useOnboardingTour());
    expect(result.current.isActive).toBe(false);
  });

  it('starts at step 0', () => {
    const { result } = renderHook(() => useOnboardingTour());
    expect(result.current.currentStep).toBe(0);
  });

  it('exposes the correct total step count', () => {
    const { result } = renderHook(() => useOnboardingTour());
    expect(result.current.totalSteps).toBe(TOUR_STEPS.length);
  });

  it('currentStepData is null when tour is inactive', () => {
    localStorageMock.setItem(STORAGE_KEY, 'true');
    const { result } = renderHook(() => useOnboardingTour());
    expect(result.current.currentStepData).toBeNull();
  });

  it('currentStepData matches TOUR_STEPS[currentStep] when active', () => {
    const { result } = renderHook(() => useOnboardingTour());
    expect(result.current.currentStepData).toEqual(TOUR_STEPS[0]);
  });

  it('next() advances the step', () => {
    const { result } = renderHook(() => useOnboardingTour());
    act(() => { result.current.next(); });
    expect(result.current.currentStep).toBe(1);
    expect(result.current.currentStepData).toEqual(TOUR_STEPS[1]);
  });

  it('next() on the last step finishes the tour', () => {
    const { result } = renderHook(() => useOnboardingTour());
    // Advance to last step
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) {
      act(() => { result.current.next(); });
    }
    expect(result.current.currentStep).toBe(TOUR_STEPS.length - 1);
    act(() => { result.current.next(); });
    expect(result.current.isActive).toBe(false);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'true');
  });

  it('prev() decrements the step', () => {
    const { result } = renderHook(() => useOnboardingTour());
    act(() => { result.current.next(); }); // step 1
    act(() => { result.current.prev(); }); // step 0
    expect(result.current.currentStep).toBe(0);
  });

  it('prev() does not go below step 0', () => {
    const { result } = renderHook(() => useOnboardingTour());
    act(() => { result.current.prev(); });
    expect(result.current.currentStep).toBe(0);
  });

  it('skip() deactivates the tour and sets the localStorage flag', () => {
    const { result } = renderHook(() => useOnboardingTour());
    act(() => { result.current.skip(); });
    expect(result.current.isActive).toBe(false);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'true');
  });

  it('finish() deactivates the tour and persists the completion flag', () => {
    const { result } = renderHook(() => useOnboardingTour());
    act(() => { result.current.finish(); });
    expect(result.current.isActive).toBe(false);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'true');
  });

  it('finish() resets currentStep to 0', () => {
    const { result } = renderHook(() => useOnboardingTour());
    act(() => { result.current.next(); });
    act(() => { result.current.finish(); });
    expect(result.current.currentStep).toBe(0);
  });

  it('restart() clears the flag and reactivates the tour from step 0', () => {
    localStorageMock.setItem(STORAGE_KEY, 'true');
    const { result } = renderHook(() => useOnboardingTour());
    expect(result.current.isActive).toBe(false);

    act(() => { result.current.restart(); });
    expect(result.current.isActive).toBe(true);
    expect(result.current.currentStep).toBe(0);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('tour does not re-trigger on subsequent renders after completion', () => {
    const { result, rerender } = renderHook(() => useOnboardingTour());
    act(() => { result.current.finish(); });
    rerender();
    expect(result.current.isActive).toBe(false);
  });
});

// ── Enabled gate (tour shows after wallet connection) ──────────────────────────

describe('useOnboardingTour — enabled gate', () => {
  it('does not auto-start when disabled (no wallet connected yet)', () => {
    const { result } = renderHook(() => useOnboardingTour({ enabled: false }));
    expect(result.current.isActive).toBe(false);
  });

  it('auto-starts once the wallet connects (enabled flips to true)', () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useOnboardingTour({ enabled }),
      { initialProps: { enabled: false } },
    );
    expect(result.current.isActive).toBe(false);

    rerender({ enabled: true });
    expect(result.current.isActive).toBe(true);
  });
});

// ── Stream state adaptation ───────────────────────────────────────────────────

describe('buildTourSteps — stream state adaptation', () => {
  it('uses the same number of steps regardless of stream state', () => {
    const states: StreamState[] = ['pre-cliff', 'active', 'completed'];
    const counts = states.map((s) => buildTourSteps(s).length);
    expect(new Set(counts).size).toBe(1);
  });

  it('pre-cliff copy explains tokens are still locked', () => {
    const step = buildTourSteps('pre-cliff').find((s) => s.id === 'timeline')!;
    expect(step.description).toMatch(/cliff must pass before you can claim/i);
  });

  it('post-cliff copy states the cliff has already passed', () => {
    const step = buildTourSteps('active').find((s) => s.id === 'timeline')!;
    expect(step.description).toMatch(/cliff has passed/i);
  });

  it('claim step differs between pre-cliff and post-cliff', () => {
    const pre = buildTourSteps('pre-cliff').find((s) => s.id === 'claim')!;
    const post = buildTourSteps('completed').find((s) => s.id === 'claim')!;
    expect(pre.description).not.toBe(post.description);
  });

  it('hook exposes the adapted step for the given stream state', () => {
    const { result } = renderHook(() => useOnboardingTour({ streamState: 'active' }));
    expect(result.current.currentStepData?.description).toMatch(/cliff has passed/i);
  });

  it('every step has a unique id and non-empty title/description', () => {
    const steps = buildTourSteps('pre-cliff');
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const step of steps) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
    }
  });
});

// ── Navigation + replay ───────────────────────────────────────────────────────

describe('useOnboardingTour — navigation and replay', () => {
  it('goToStep() jumps to an absolute index', () => {
    const { result } = renderHook(() => useOnboardingTour());
    act(() => { result.current.goToStep(3); });
    expect(result.current.currentStep).toBe(3);
  });

  it('goToStep() clamps out-of-range indices', () => {
    const { result } = renderHook(() => useOnboardingTour());
    act(() => { result.current.goToStep(999); });
    expect(result.current.currentStep).toBe(result.current.totalSteps - 1);

    act(() => { result.current.goToStep(-5); });
    expect(result.current.currentStep).toBe(0);
  });

  it('replayTour() restarts a completed tour from step 0', () => {
    localStorageMock.setItem(STORAGE_KEY, 'true');
    const { result } = renderHook(() => useOnboardingTour());
    expect(result.current.isActive).toBe(false);

    act(() => { replayTour(); });
    expect(result.current.isActive).toBe(true);
    expect(result.current.currentStep).toBe(0);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('replayTour() after finishing mid-tour returns to step 0', () => {
    const { result } = renderHook(() => useOnboardingTour());
    act(() => { result.current.next(); });
    act(() => { result.current.next(); });
    expect(result.current.currentStep).toBe(2);

    act(() => { replayTour(); });
    expect(result.current.currentStep).toBe(0);
  });
});
