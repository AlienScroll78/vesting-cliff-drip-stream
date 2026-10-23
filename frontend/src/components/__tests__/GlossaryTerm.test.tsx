import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlossaryTerm } from '../GlossaryTerm';

describe('GlossaryTerm', () => {
  it('renders the canonical label when no children are given', () => {
    render(<GlossaryTerm term="cliff" />);
    expect(screen.getByText('Cliff')).toBeInTheDocument();
  });

  it('renders custom children text', () => {
    render(<GlossaryTerm term="ledger">current ledger</GlossaryTerm>);
    expect(screen.getByText('current ledger')).toBeInTheDocument();
  });

  it('applies a dotted underline via tooltip trigger styles', () => {
    render(<GlossaryTerm term="sponsor" />);
    const trigger = screen.getByRole('button', { name: /sponsor/i });
    expect(trigger).toHaveStyle('border-bottom: 1px dotted currentColor');
  });

  it('shows tooltip definition on hover', async () => {
    render(<GlossaryTerm term="cliff" />);
    const trigger = screen.getByRole('button', { name: /cliff/i });
    fireEvent.mouseEnter(trigger);
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'A mandatory lock-up period',
    );
  });

  it('hides tooltip on mouse leave', () => {
    render(<GlossaryTerm term="cliff" />);
    const trigger = screen.getByRole('button', { name: /cliff/i });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows tooltip on focus (keyboard navigation)', async () => {
    render(<GlossaryTerm term="ledger" />);
    const trigger = screen.getByRole('button', { name: /ledger/i });
    trigger.focus();
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
  });

  it('hides tooltip on Escape key', async () => {
    const user = userEvent.setup();
    render(<GlossaryTerm term="ledger" />);
    const trigger = screen.getByRole('button', { name: /ledger/i });
    trigger.focus();
    await screen.findByRole('tooltip');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('wires aria-describedby when tooltip is visible', async () => {
    render(<GlossaryTerm term="sponsor" />);
    const trigger = screen.getByRole('button', { name: /sponsor/i });
    fireEvent.focus(trigger);
    const tooltip = await screen.findByRole('tooltip');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
  });

  it('renders a learn-more link pointing to the glossary anchor', async () => {
    render(<GlossaryTerm term="token" />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: /token/i }));
    const link = await screen.findByRole('link', { name: /learn more/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('#token'));
  });

  it('renders nothing special for unknown terms', () => {
    render(<GlossaryTerm term="unknownxyz">some text</GlossaryTerm>);
    expect(screen.getByText('some text')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
