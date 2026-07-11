import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const board = readFileSync(fileURLToPath(new URL('../autobid-board.html', import.meta.url)), 'utf8');
const send = readFileSync(fileURLToPath(new URL('../autobid-send.html', import.meta.url)), 'utf8');
const studio = readFileSync(fileURLToPath(new URL('../autosprink.html', import.meta.url)), 'utf8');

describe('AutoBid canonical source-document binding', () => {
  it('routes board 3D/drawing links through the resolved plan-set document', () => {
    expect(board).toContain('b.geometry_document_id!=null');
    expect(board).not.toContain('b.geometry_document_id||b.document_id');
    expect(board).toContain('boardHeader3d');
    expect(board).toContain('geometry_document_id!=null');
    expect(board).not.toContain('href="/autosprink.html?doc=34978"');
  });

  it('does not fall back from send review to a priced workbook', () => {
    expect(send).toContain('p.geometry_document_id');
    expect(send).toContain('p.meta&&p.meta.geometry_document_id');
    expect(send).toContain('var docId = p.geometry_document_id');
    expect(send).not.toContain('p.meta&&p.meta.document_id) || rb.document_id');
  });

  it('resolves doc-bound Studio identity before the plan loader and never renders the default fixture identity', () => {
    expect(studio).toContain('bindSourceDocumentIdentity');
    expect(studio).toContain('document.body.dataset.sourceDocumentId');
    expect(studio).toContain('Loading source-bound job');
    expect(studio).toContain('await bindSourceDocumentIdentity()');
    expect(studio).toContain("$('projectTarget').value = COOPERATIVE_1881_PROJECT_NAME");
    expect(studio).not.toContain('<div class="job-title">Home Depot — Rexburg</div>');
  });
});
