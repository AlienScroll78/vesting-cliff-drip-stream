import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ErrorBoundary from '../ErrorBoundary';

// Suppress React's console.error output for expected errors in tests
const originalConsoleError = console.error;
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
  console.error = originalConsoleError;
});

// Mock @sentry/react so tests don't need a real Sentry project
jest.mock('@sentry/react', () => ({
  captureException: jest.fn(() => 'mock-event-id-123'),
  showReportDialog: jest.fn(),
}));

// Helper: a component that intentionally throws
function BrokenComponent({ shouldThrow = false }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error('Test render error');
  return <div>Working fine</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Hello world</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );

    expect(
      screen.getByRole('heading', { name: /something went wrong/i }),
    ).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument();
  });

  it('fallback heading has a negative tabIndex for programmatic focus', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );

    const heading = screen.getByRole('heading', { name: /something went wrong/i });
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('fallback main region is labelled by the heading (aria-labelledby)', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );

    const main = screen.getByRole('main');
    const heading = screen.getByRole('heading', { name: /something went wrong/i });
    expect(main).toHaveAttribute('aria-labelledby', heading.id);
  });

  it('calls Sentry.captureException with the error and component stack', () => {
    const { captureException } = require('@sentry/react');

    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({ componentStack: expect.any(String) }),
      }),
    );
  });

  it('shows the Report this issue button after Sentry captures an event', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );

    // captureException mock returns 'mock-event-id-123'
    expect(
      screen.getByRole('button', { name: /report this issue/i }),
    ).toBeInTheDocument();
  });

  it('does not crash when children do not throw', () => {
    expect(() => {
      render(
        <ErrorBoundary>
          <BrokenComponent shouldThrow={false} />
        </ErrorBoundary>,
      );
    }).not.toThrow();

    expect(screen.getByText('Working fine')).toBeInTheDocument();
  });
});
