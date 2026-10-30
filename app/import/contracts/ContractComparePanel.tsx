
'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Eye,
  FileText,
  Loader2,
  X,
} from 'lucide-react';

type ContractValue = string | number | boolean | null;

type ContractFields = Record<string, ContractValue>;

type ContractComparePanelProps = {
  documentName: string;
  documentPath: string;
  fields: ContractFields;
  onFieldsChange: (fields: ContractFields) => void;
  onClose: () => void;
};

export default function ContractComparePanel({
  documentName,
  documentPath,
  fields,
  onFieldsChange,
  onClose,
}: ContractComparePanelProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isImage = /\.(jpe?g|png)$/i.test(documentName);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);
      setError('');

      try {
        const response = await fetch(
          '/api/import-contracts/preview-upload',
          {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ storagePath: documentPath }),
          },
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || 'Unable to load the original contract.',
          );
        }

        if (!data.url) {
          throw new Error('No document preview URL was returned.');
        }

        if (!cancelled) setUrl(data.url);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load the original contract.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (!documentPath) {
      setError('The original document path is missing.');
      setLoading(false);
      return;
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [documentPath]);

  function updateField(key: string, value: string) {
    onFieldsChange({
      ...fields,
      [key]: value,
    });
  }

  function displayValue(value: ContractValue) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return String(value);
    return String(value);
  }

  const entries = Object.entries(fields);

  return (
    <div className="cc-overlay">
      <section
        className="cc-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cc-title"
      >
        <header className="cc-toolbar">
          <div className="cc-toolbar-title">
            <button
              type="button"
              className="cc-icon-button"
              onClick={onClose}
              aria-label="Close comparison"
              title="Back"
            >
              <ChevronLeft size={20} />
            </button>

            <div>
              <h2 id="cc-title">Contract comparison</h2>
              <p>Review the original document and extracted fields</p>
            </div>
          </div>

          <button
            type="button"
            className="cc-close-button"
            onClick={onClose}
          >
            <X size={16} />
            Close comparison
          </button>
        </header>

        <div className="cc-columns">
          <section className="cc-column">
            <div className="cc-column-heading">
              <FileText size={18} />
              <div>
                <h3>Original contract</h3>
                <p title={documentName}>{documentName}</p>
              </div>
            </div>

            <div className="cc-document-area">
              {loading && (
                <div className="cc-message">
                  <Loader2 className="cc-spinner" size={24} />
                  <span>Loading original document…</span>
                </div>
              )}

              {error && (
                <div className="cc-message cc-error" role="alert">
                  <AlertCircle size={20} />
                  <span>{error}</span>
                  <button
                    type="button"
                    className="cc-secondary-button"
                    onClick={() => {
                      setUrl('');
                      setError(
                        'Close and reopen comparison to retry loading.',
                      );
                    }}
                  >
                    Close and reopen to retry
                  </button>
                </div>
              )}

              {!loading && !error && url && (
                isImage ? (
                  <div className="cc-image-viewer">
                    <img
                      src={url}
                      alt={`Original contract: ${documentName}`}
                    />
                  </div>
                ) : (
                  <iframe
                    className="cc-pdf-viewer"
                    src={url}
                    title={`Original contract: ${documentName}`}
                  />
                )
              )}
            </div>
          </section>

          <section className="cc-column">
            <div className="cc-column-heading">
              <Eye size={18} />
              <div>
                <h3>Extracted contract details</h3>
                <p>
                  {entries.length} fields · Editable review
                </p>
              </div>
            </div>

            <div className="cc-fields-area">
              {entries.length === 0 ? (
                <div className="cc-empty">
                  No extracted fields are available for review.
                </div>
              ) : (
                entries.map(([key, value]) => {
                  const isMissing =
                    value === null ||
                    value === undefined ||
                    String(value).trim() === '';

                  return (
                    <label className="cc-field" key={key}>
                      <span className="cc-field-label">
                        <span>{key.replace(/([A-Z])/g, ' $1')
                          .replace(/[_-]/g, ' ')
                          .replace(/^./, (s) => s.toUpperCase())}</span>

                        {isMissing && (
                          <span className="cc-missing">
                            Missing value
                          </span>
                        )}
                      </span>

                      <input
                        type="text"
                        value={displayValue(value)}
                        placeholder="Enter or correct value"
                        className={
                          isMissing
                            ? 'cc-input cc-input-missing'
                            : 'cc-input'
                        }
                        onChange={(event) =>
                          updateField(key, event.target.value)
                        }
                      />
                    </label>
                  );
                })
              )}

              <div className="cc-review-note">
                <AlertCircle size={16} />
                <span>
                  Review extracted values against the original document.
                  Missing fields are highlighted, but automatic mismatch
                  detection requires the original document text to be
                  extracted separately.
                </span>
              </div>
            </div>
          </section>
        </div>

        <footer className="cc-footer">
          <span className="cc-footer-hint">
            <Check size={16} />
            Your edits remain in the parent form until you save.
          </span>

          <button
            type="button"
            className="cc-primary-button"
            onClick={onClose}
          >
            Done reviewing
          </button>
        </footer>
      </section>
    </div>
  );
}
