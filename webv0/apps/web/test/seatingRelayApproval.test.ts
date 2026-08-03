import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApprovalDto, MemberDto } from '../src/api';
import { SeatingApprovalReceipt } from '../src/pages/ApprovalDetailPage';
import { deriveSeatingReviewAvailability, SeatingRequestHandoff } from '../src/pages/MembersPage';

function inRouter(child: ReactElement): string {
  return renderToStaticMarkup(createElement(StaticRouter, { location: '/' }, child));
}

function renderReceipt(status: ApprovalDto['status'], canReadMembers = true): string {
  return inRouter(
    createElement(SeatingApprovalReceipt, {
      operationType: 'ProvisionMember',
      status,
      requestedRole: 'operations',
      canReadMembers,
    }),
  );
}

describe('D-022 admitting-person seating relay', () => {
  const states: Array<{ status: ApprovalDto['status']; title: string; truth: string }> = [
    {
      status: 'Submitted',
      title: 'Seat request submitted',
      truth: 'It has not created a seat; review and execution are still required.',
    },
    {
      status: 'InReview',
      title: 'Seat request in review',
      truth: 'It has not created a seat; a decision and execution are still required.',
    },
    {
      status: 'Approved',
      title: 'Approved — not yet seated',
      truth: 'This request has not executed, so it has not created a seat.',
    },
    {
      status: 'Executed',
      title: 'Seat created by this request',
      truth: 'Execution proves this request created the requested operations seat. It does not prove that access remains active.',
    },
    {
      status: 'Rejected',
      title: 'Seat request rejected',
      truth: 'This request ended at review and was never executed. It did not create a seat.',
    },
    {
      status: 'Withdrawn',
      title: 'Seat request withdrawn',
      truth: 'This request was withdrawn before execution. It did not create a seat.',
    },
    {
      status: 'ExecutionFailed',
      title: 'Execution failed',
      truth: 'Execution did not complete. This request has not created a seat; an authorized owner may retry it.',
    },
  ];

  for (const { status, title, truth } of states) {
    it(`${status} says exactly what this request has proved`, () => {
      const markup = renderReceipt(status);
      expect(markup).toContain('data-testid="seating-approval-receipt"');
      expect(markup).toContain(`data-seating-status="${status}"`);
      expect(markup).toContain(title);
      expect(markup).toContain(truth);
    });
  }

  it('links current standing to Members only for a reader with member-directory standing', () => {
    const allowed = renderReceipt('Executed');
    expect(allowed).toContain('data-testid="seating-current-standing-link"');
    expect(allowed).toContain('href="/members"');

    const withheld = renderReceipt('Executed', false);
    expect(withheld).not.toContain('seating-current-standing-link');
    expect(withheld).not.toContain('href="/members"');
    expect(withheld).toContain('Current standing belongs to the Members register and is not asserted here.');
  });

  it('does not render a seating receipt for an ordinary approval', () => {
    const markup = inRouter(
      createElement(SeatingApprovalReceipt, {
        operationType: 'AddPerson',
        status: 'Submitted',
        requestedRole: null,
        canReadMembers: true,
      }),
    );
    expect(markup).toBe('');
  });

  it('hands a successful ProvisionMember submission to its approval without claiming access', () => {
    const markup = inRouter(
      createElement(SeatingRequestHandoff, {
        approvalId: 'APR-0042',
        requestedRole: 'finance',
        displayName: 'Amina Rahman',
        email: 'amina@example.com',
        reviewAvailability: 'available',
      }),
    );
    expect(markup).toContain('data-testid="seating-request-handoff"');
    expect(markup).toContain('APR-0042');
    expect(markup).toContain('Amina Rahman · amina@example.com');
    expect(markup).toContain('<h2>No access yet</h2>');
    expect(markup).toContain('Requested role: finance.');
    expect(markup).toContain('A different authorized actor must');
    expect(markup).toContain('href="/approvals/APR-0042"');
  });

  it('makes a sole-requester dead end explicit instead of implying the request can advance', () => {
    const markup = inRouter(
      createElement(SeatingRequestHandoff, {
        approvalId: 'APR-0043',
        requestedRole: 'visitor',
        displayName: 'First Stranger',
        email: 'first@example.com',
        reviewAvailability: 'unavailable',
      }),
    );
    expect(markup).toContain('data-testid="seating-request-blocked"');
    expect(markup).toContain('no other active member who can review and execute it');
    expect(markup).not.toContain('A different authorized actor must');
  });

  it('derives completion standing only from a proven register fact', () => {
    const requester = {
      userId: '10000000-0000-4000-8000-000000000001',
      email: 'owner@example.com',
      displayName: 'Owner',
      role: 'owner',
      isActive: true,
      createdAt: '2026-08-04T00:00:00.000Z',
    } satisfies MemberDto;
    const otherOwner = { ...requester, userId: '10000000-0000-4000-8000-000000000002', email: 'other@example.com' };
    const possibleDelegate = {
      ...requester,
      userId: '10000000-0000-4000-8000-000000000003',
      email: 'ops@example.com',
      role: 'operations',
    } satisfies MemberDto;

    expect(deriveSeatingReviewAvailability([requester], requester.userId, true)).toBe('unavailable');
    expect(deriveSeatingReviewAvailability([requester, otherOwner], requester.userId, true)).toBe('available');
    expect(deriveSeatingReviewAvailability([requester, possibleDelegate], requester.userId, true)).toBe('unknown');
    expect(deriveSeatingReviewAvailability([requester, otherOwner], requester.userId, false)).toBe('unknown');
    expect(deriveSeatingReviewAvailability([requester, otherOwner], undefined, true)).toBe('unknown');
    expect(deriveSeatingReviewAvailability(undefined, requester.userId, true)).toBe('unknown');
  });
});
