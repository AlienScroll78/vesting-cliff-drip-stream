import { renderHook, act } from '@testing-library/react';
import { useOnboardingTour, TOUR_STEPS } from '../../useOnboardingTour';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const STORAGE_KEY = 'vesting_onboarding_complete';

beforeEach(() => {
  localStorageMock.clear();
  jest.clearAllMocks();
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
