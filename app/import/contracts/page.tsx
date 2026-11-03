
"use client";
import Link from "next/link";
import ContractComparePanel from './ContractComparePanel';
import { DayBookUpload } from '../DayBookUpload';
import './contract-compare.css';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2,
  ChevronDown, Clock3, Download, Eye, FileImage, FileText, Filter,
  History, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck,
  Sparkles, Trash2, Upload, X, FileCheck2, Package, CircleHelp, FileSpreadsheet,
} from "lucide-react";

type ContractStatus = "Draft" | "Pending Review" | "Confirmed";

type MaterialLine = {
  materialName: string;
  gradeDescription: string;
  quantity: string;
  uom: "MT" | "KG" | "";
  unitPrice: string;
  currency: string;
  contractValue: string;
};

type ContractFields = {
  contractNumber: string;
  contractDate: string;
  supplierName: string;
  supplierCountry: string;
  buyerName: string;
  productMaterialName: string;
  gradeDescription: string;
  quantity: string;
  uom: "MT" | "KG" | "";
  unitPrice: string;
  currency: string;
  totalContractValue: string;
  shipmentDatePeriod: string;
  portOfLoading: string;
  portOfDestination: string;
  paymentTerms: string;
  incoterms: string;
  otherConditions: string;
};

type Contract = {
  id: string;
  importId: string;
  status: ContractStatus;
  fields: ContractFields;
  materials: MaterialLine[];
  documentName?: string;
  documentUrl?: string;
  documentPath?: string;
  createdAt?: string;
  updatedAt?: string;
  warnings?: string[];
  uncertainFields?: string[];
  missingFields?: string[];

  // Duplicate detection information
  duplicateOf?: {
    id: string;
    importId?: string;
    contractNumber?: string;
    supplierName?: string;
  } | null;

  duplicateInBatch?: string | null;

  history?: { action: string; by?: string; at?: string }[];
};

type ExtractedDocument = {
  fileId?: string;
  documentName: string;
  documentUrl?: string;
  documentPath?: string;
  fields: Partial<ContractFields>;
  materials?: Partial<MaterialLine>[];
  warnings?: string[];
  uncertainFields?: string[];
  missingFields?: string[];

  // Duplicate detection information
  duplicateOf?: {
    id: string;
    importId?: string;
    contractNumber?: string;
    supplierName?: string;
  } | null;

  duplicateInBatch?: string | null;
};
const EMPTY_FIELDS: ContractFields = {
  contractNumber: "",
  contractDate: "",
  supplierName: "",
  supplierCountry: "",
  buyerName: "",
  productMaterialName: "",
  gradeDescription: "",
  quantity: "",
  uom: "",
  unitPrice: "",
  currency: "",
  totalContractValue: "",
  shipmentDatePeriod: "",
  portOfLoading: "",
  portOfDestination: "",
  paymentTerms: "",
  incoterms: "",
  otherConditions: "",
};

const FIELD_GROUPS: { title: string; fields: { key: keyof ContractFields; label: string; type?: string; placeholder?: string }[] }[] = [
  {
    title: "Contract details",
    fields: [
      { key: "contractNumber", label: "Contract number", placeholder: "As stated in document" },
      { key: "contractDate", label: "Contract date", type: "date" },
      { key: "buyerName", label: "Buyer name" },
      { key: "supplierName", label: "Supplier name" },
      { key: "supplierCountry", label: "Supplier country" },
    ],
  },
  {
    title: "Material & pricing",
    fields: [
      { key: "productMaterialName", label: "Product / material name" },
      { key: "gradeDescription", label: "Grade / description" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "uom", label: "Unit of measure" },
      { key: "unitPrice", label: "Unit price", type: "number" },
      { key: "currency", label: "Currency", placeholder: "e.g. USD, EUR, INR" },
      { key: "totalContractValue", label: "Total contract value", type: "number" },
    ],
  },
  {
    title: "Shipment & commercial terms",
    fields: [
      { key: "shipmentDatePeriod", label: "Shipment date / period", placeholder: "As stated in contract" },
      { key: "portOfLoading", label: "Port of loading" },
      { key: "portOfDestination", label: "Port of destination" },
      { key: "paymentTerms", label: "Payment terms" },
      { key: "incoterms", label: "Incoterms" },
      { key: "otherConditions", label: "Other conditions" },
    ],
  },
];

const FIELD_LABELS: Record<keyof ContractFields, string> = Object.fromEntries(
  FIELD_GROUPS.flatMap((group) => group.fields.map((field) => [field.key, field.label]))
) as Record<keyof ContractFields, string>;

const STATUS_CLASS: Record<ContractStatus, string> = {
  Draft: "draft",
  "Pending Review": "pending",
  Confirmed: "active",
};

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function normalizeContract (raw: any): Contract {
  const fields = { ...EMPTY_FIELDS, ...(raw?.fields ?? raw ?? {}) };
  const materials = Array.isArray(raw?.materials)
    ? raw.materials.map((material: any) => ({
        materialName: textValue(material.materialName ?? material.productMaterialName),
        gradeDescription: textValue(material.gradeDescription),
        quantity: textValue(material.quantity),
        uom: material.uom === "MT" || material.uom === "KG" ? material.uom : "",
        unitPrice: textValue(material.unitPrice),
        currency: textValue(material.currency ?? fields.currency),
        contractValue: textValue(material.contractValue ?? material.totalContractValue),
      }))
    : [];

  return {
    id: textValue(raw?.id ?? raw?.internalId ?? raw?.importId ?? crypto.randomUUID()),
    importId: textValue(raw?.importId ?? raw?.internalId ?? ""),
    status: raw?.status === "Confirmed" || raw?.status === "Draft" ? raw.status : "Pending Review",
    fields,
    materials,
    documentName: textValue(raw?.documentName ?? raw?.fileName ?? raw?.originalFileName),
    documentUrl: raw?.documentUrl ?? raw?.fileUrl ?? "",
    documentPath: textValue(raw?.documentPath ?? raw?.storage_path),
    createdAt: raw?.createdAt,
    updatedAt: raw?.updatedAt,
       warnings: Array.isArray(raw?.warnings) ? raw.warnings : [],

    uncertainFields: Array.isArray(raw?.uncertainFields) ? raw.uncertainFields : [],

    missingFields: Array.isArray(raw?.missingFields) ? raw.missingFields : [],

    // Preserve duplicate detection information
    duplicateOf: raw?.duplicateOf ?? null,
    duplicateInBatch: raw?.duplicateInBatch ?? null,

    history: Array.isArray(raw?.history) ? raw.history : [],
  };
}

function errorMessage(data: any, fallback: string) {
  return data?.error || data?.message || fallback;
}


function InlineOriginalPreview({
  documentName,
  documentPath,
}: {
  documentName: string;
  documentPath?: string;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  

async function openPreview() {
  setOpen(true);
  setLoading(true);
  setError('');
  setUrl('');

  try {
    if (!documentPath) {
      throw new Error('Original document path is missing.');
    }

    const response = await fetch(
      '/api/import-contracts/preview-upload',
      {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storagePath: documentPath,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || `Preview request failed (${response.status}).`,
      );
    }

    if (!data.url) {
      throw new Error('The API returned no preview URL.');
    }

    setUrl(data.url);
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : 'Unable to preview the original document.',
    );
  } finally {
    setLoading(false);
  }
}


  const isImage = /\.(jpe?g|png)$/i.test(documentName);

  function closePreview() {
    setOpen(false);
    setUrl('');
    setError('');
  }

  return (
    <section className="icr-original-preview">
      <div className="icr-original-document">
        <div className="icr-original-icon">
          <FileText size={22} />
        </div>

        <div className="icr-original-copy">
          <strong>Original contract</strong>
          <span>{documentName || 'Original document'}</span>
        </div>

     
<button
  type="button"
  className="icr-btn icr-btn-outline icr-btn-small"
  disabled={!documentPath}
  onClick={() => {
    if (open) {
      closePreview();
    } else {
      void openPreview();
    }
  }}
  aria-expanded={open}
>
  <Eye size={15} />
  {open ? 'Hide preview' : 'Preview original'}
</button>

      </div>

      {open && (
        <div className="icr-inline-preview-panel">
          <div className="icr-inline-preview-header">
            <strong>{documentName || 'Original contract'}</strong>
            <button
              type="button"
              className="icr-btn icr-btn-outline icr-btn-small"
              onClick={closePreview}
            >
              <X size={15} /> Close
            </button>
          </div>

          {loading && (
            <p className="icr-preview-message">
              <Loader2 size={18} className="icr-spinner" />
              Loading original document…
            </p>
          )}

          {error && (
            <div className="icr-inline-error" role="alert">
              <AlertCircle size={16} />
              {error}
              <button
                type="button"
                className="icr-text-button"
                onClick={() => {
                  setUrl('');
                  setError('');
                  setOpen(false);
                  window.setTimeout(() => setOpen(true), 0);
                }}
              >
                Try again
              </button>
            </div>
          )}

          {url && (
            isImage ? (
              <div className="icr-image-preview">
                <img src={url} alt={`Original contract: ${documentName}`} />
              </div>
            ) : (
              <iframe
                className="icr-inline-preview-frame"
                src={url}
                title={`Original contract: ${documentName}`}
                referrerPolicy="no-referrer"
              />
            )
          )}
        </div>
      )}
    </section>
  );
}

export default function ImportContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortBy, setSortBy] = useState("newest");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [reviewQueue, setReviewQueue] = useState<Contract[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);

  const [detailContract, setDetailContract] = useState<Contract | null>(null);
  const [editContract, setEditContract] = useState<Contract | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [toast, setToast] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchContracts = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/import-contracts", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data, "Could not load import contracts."));
      const rows = Array.isArray(data) ? data : data.contracts ?? data.data ?? [];
      setContracts(rows.map(normalizeContract));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load import contracts.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  };

  const filteredContracts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = contracts.filter((contract) => {
      const f = contract.fields;
      const matchesSearch = !term || [
        contract.importId,
        f.contractNumber,
        f.supplierName,
        f.supplierCountry,
        f.productMaterialName,
        f.buyerName,
      ].some((value) => textValue(value).toLowerCase().includes(term));
      const matchesStatus = statusFilter === "All" || contract.status === statusFilter;
      return matchesSearch && matchesStatus;
    });

    return rows.sort((a, b) => {
      if (sortBy === "supplier") return a.fields.supplierName.localeCompare(b.fields.supplierName);
      if (sortBy === "value") return Number(b.fields.totalContractValue || 0) - Number(a.fields.totalContractValue || 0);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }, [contracts, search, statusFilter, sortBy]);

  const stats = useMemo(() => ({
    total: contracts.length,
    review: contracts.filter((c) => c.status === "Pending Review").length,
    confirmed: contracts.filter((c) => c.status === "Confirmed").length,
    draft: contracts.filter((c) => c.status === "Draft").length,
  }), [contracts]);

  const currentReview = reviewQueue[reviewIndex] ?? null;

  function updateReviewField(key: keyof ContractFields, value: string) {
    setReviewQueue((previous) => previous.map((contract, index) =>
      index === reviewIndex
        ? { ...contract, fields: { ...contract.fields, [key]: value } }
        : contract
    ));
  }

  function updateReviewMaterial(index: number, key: keyof MaterialLine, value: string) {
    setReviewQueue((previous) => previous.map((contract, queueIndex) => {
      if (queueIndex !== reviewIndex) return contract;
      const materials = [...contract.materials];
      materials[index] = { ...materials[index], [key]: value };
      return { ...contract, materials };
    }));
  }

  function addMaterial() {
    setReviewQueue((previous) => previous.map((contract, index) =>
      index === reviewIndex
        ? {
            ...contract,
            materials: [...contract.materials, {
              materialName: "", gradeDescription: "", quantity: "", uom: "",
              unitPrice: "", currency: contract.fields.currency, contractValue: "",
            }],
          }
        : contract
    ));
  }

  function removeMaterial(index: number) {
    setReviewQueue((previous) => previous.map((contract, queueIndex) =>
      queueIndex === reviewIndex
        ? { ...contract, materials: contract.materials.filter((_, i) => i !== index) }
        : contract
    ));
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    const accepted = chosen.filter((file) =>
      file.type === "application/pdf" ||
      file.type === "image/jpeg" ||
      file.type === "image/png" ||
      /\.(pdf|jpe?g|png)$/i.test(file.name)
    );
    const rejected = chosen.length - accepted.length;
    setFiles((previous) => [...previous, ...accepted]);
    setUploadError(rejected ? `${rejected} unsupported file(s) skipped. Upload PDF, JPG or PNG files.` : "");
    event.target.value = "";
  }

  async function startExtraction() {
    if (!files.length) {
      setUploadError("Choose at least one PDF, JPG or PNG file.");
      return;
    }
    setExtracting(true);
    setUploadError("");

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      // This endpoint should securely store each original and return extracted fields.
      const response = await fetch("/api/import-contracts/extract", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data, "Contract extraction failed."));

      const extractedRows = Array.isArray(data) ? data : data.contracts ?? data.results ?? [];
      if (!extractedRows.length) {
        throw new Error("The extraction service returned no contracts to review.");
      }

      const queue = extractedRows.map((raw: ExtractedDocument) => {
        const fields = { ...EMPTY_FIELDS, ...(raw.fields ?? {}) };
        const materials = (raw.materials?.length ? raw.materials : [{
          materialName: fields.productMaterialName,
          gradeDescription: fields.gradeDescription,
          quantity: fields.quantity,
          uom: fields.uom,
          unitPrice: fields.unitPrice,
          currency: fields.currency,
          contractValue: fields.totalContractValue,
        }]).map((m) => ({
          materialName: textValue(m.materialName),
          gradeDescription: textValue(m.gradeDescription),
          quantity: textValue(m.quantity),
          uom: m.uom === "MT" || m.uom === "KG" ? m.uom : "",
          unitPrice: textValue(m.unitPrice),
          currency: textValue(m.currency ?? fields.currency),
          contractValue: textValue(m.contractValue),
        }));

                return normalizeContract({
          id: crypto.randomUUID(),
          status: "Pending Review",
          fields,
          materials,
          documentName: raw.documentName,
          documentUrl: raw.documentUrl,
          documentPath: raw.documentPath,
          warnings: raw.warnings ?? [],
          uncertainFields: raw.uncertainFields ?? [],
          missingFields: raw.missingFields ?? [],

          // Pass duplicate information from the extraction API
          duplicateOf: raw.duplicateOf ?? null,
          duplicateInBatch: raw.duplicateInBatch ?? null,
        });
      });

      setReviewQueue(queue);
      setReviewIndex(0);
      setUploadOpen(false);
      setReviewOpen(true);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not process these documents.");
    } finally {
      setExtracting(false);
    }
  }

  async function confirmCurrentContract() {
    if (!currentReview) return;
    setSavingReview(true);
    setReviewError("");

    try {
      const payload = {
        ...currentReview,
        status: "Confirmed" as const,
        // The server must generate the unique Import ID and perform duplicate checks.
        confirm: true,
      };

      const response = await fetch("/api/import-contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data, "Could not confirm this contract."));

      const nextQueue = reviewQueue.filter((_, index) => index !== reviewIndex);
      if (nextQueue.length) {
        setReviewQueue(nextQueue);
        setReviewIndex(Math.min(reviewIndex, nextQueue.length - 1));
      } else {
        setReviewOpen(false);
        setReviewQueue([]);
      }
      await fetchContracts(true);
      notify("Contract confirmed and saved.");
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Could not confirm this contract.");
    } finally {
      setSavingReview(false);
    }
  }

  async function saveEditedContract() {
    if (!editContract) return;
    setSavingEdit(true);
    setEditError("");

    try {
      const response = await fetch(`/api/import-contracts/${encodeURIComponent(editContract.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: editContract.fields, materials: editContract.materials }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data, "Could not update contract."));

      setEditContract(null);
      await fetchContracts(true);
      notify("Contract updated.");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Could not update contract.");
    } finally {
      setSavingEdit(false);
    }
  }

  function exportCsv() {
    const headers = [
      "Import ID", "Contract Number", "Contract Date", "Supplier", "Supplier Country",
      "Material", "Quantity", "UOM", "Unit Price", "Currency", "Contract Value",
      "Shipment Date / Period", "Status",
    ];
    const rows = filteredContracts.map((c) => [
      c.importId, c.fields.contractNumber, c.fields.contractDate, c.fields.supplierName,
      c.fields.supplierCountry, c.fields.productMaterialName, c.fields.quantity,
      c.fields.uom, c.fields.unitPrice, c.fields.currency, c.fields.totalContractValue,
      c.fields.shipmentDatePeriod, c.status,
    ]);
    const escape = (value: unknown) => `"${textValue(value).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "import-contract-register.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadOriginal(contract: Contract) {
    if (!contract.documentUrl) {
      notify("The original document download link is not available.");
      return;
    }
    window.open(contract.documentUrl, "_blank", "noopener,noreferrer");
  }

  const isFlagged = (key: keyof ContractFields, contract: Contract) =>
    contract.missingFields?.includes(key) || contract.uncertainFields?.includes(key) ||
    !textValue(contract.fields[key]).trim();

  const contractValue = (contract: Contract) => {
    const value = Number(contract.fields.totalContractValue || 0);
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  return (
    
    <main className="icr-page">
      
      <section className="icr-hero">
        
        <div className="icr-hero-content">
          <div className="icr-breadcrumb"><Link href="/import" style={{ color: "inherit" }}>Import</Link> <span>/</span> Contracts &amp; Settlement</div>
          <Link
  href="/import"
  className="icr-btn icr-btn-secondary"
  style={{ marginBottom: 12, width: "fit-content" }}
>
  <ArrowLeft size={16} />
  Back to Import
</Link>
          <div className="icr-eyebrow"><Sparkles size={15} /> AI-POWERED DOCUMENT WORKFLOW</div>
          <h1>Import Contract Portal</h1>
          <p>Extract, review and manage import contracts in one place.</p>
          <div className="icr-hero-chips">
            <span className="icr-hero-chip"><ShieldCheck size={14} /> Review before confirmation</span>
            <span className="icr-hero-chip"><FileCheck2 size={14} /> Original document linked</span>
          </div>
        </div>
        <div className="icr-hero-actions">
          <button className="icr-btn icr-btn-secondary" onClick={() => fetchContracts(true)} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? "icr-refreshing" : ""} /> Refresh
          </button>
          <button className="icr-btn icr-btn-primary" onClick={() => { setFiles([]); setUploadError(""); setUploadOpen(true); }}>
            <Plus size={17} /> Upload contract
          </button>
        </div>
      </section>

      <section className="icr-panel" style={{ marginBottom: 16, padding: "14px 18px" }}>
        <strong>Tally Day Book</strong>
        <p style={{ margin: "4px 0 10px", fontSize: 13, opacity: 0.75 }}>Upload the Day Book separately from the contracts (April to date, detailed layout). Each contract&apos;s Settlement sheet finds its duty, clearing and supplier vouchers here through the Bill of Entry number.</p>
        <DayBookUpload />
      </section>

      <section className="icr-kpis">
        <article className="icr-kpi">
          <div className="icr-kpi-top"><span className="icr-kpi-label">Total contracts</span><span className="icr-kpi-icon"><FileText size={18} /></span></div>
          <div className="icr-kpi-value">{stats.total}</div>
          <div className="icr-kpi-footer">All registered contracts</div>
        </article>
        <article className="icr-kpi">
          <div className="icr-kpi-top"><span className="icr-kpi-label">Pending review</span><span className="icr-kpi-icon"><Clock3 size={18} /></span></div>
          <div className="icr-kpi-value">{stats.review}</div>
          <div className="icr-kpi-footer">Require verification</div>
        </article>
        <article className="icr-kpi">
          <div className="icr-kpi-top"><span className="icr-kpi-label">Confirmed</span><span className="icr-kpi-icon"><CheckCircle2 size={18} /></span></div>
          <div className="icr-kpi-value">{stats.confirmed}</div>
          <div className="icr-kpi-footer">Saved to the register</div>
        </article>
        <article className="icr-kpi">
          <div className="icr-kpi-top"><span className="icr-kpi-label">Drafts</span><span className="icr-kpi-icon"><Pencil size={18} /></span></div>
          <div className="icr-kpi-value">{stats.draft}</div>
          <div className="icr-kpi-footer">Not yet confirmed</div>
        </article>
      </section>

      {error && (
        <div className="icr-alert icr-alert-error">
          <AlertCircle size={18} />
          <span>{error} Check that <code>/api/import-contracts</code> is implemented.</span>
          <button className="icr-icon-btn" onClick={() => fetchContracts()} aria-label="Retry"><RefreshCw size={16} /></button>
        </div>
      )}

      <section className="icr-panel">
        <div className="icr-panel-header">
          <div>
            <div className="icr-panel-heading">Import Contract Register <span className="icr-panel-count">{filteredContracts.length}</span></div>
            <p>Search contracts, review their status, or open a record.</p>
          </div>
          <button className="icr-btn icr-btn-outline" onClick={exportCsv}><Download size={16} /> Export CSV</button>
        </div>

        <div className="icr-toolbar">
          <div className="icr-toolbar-left">
            <label className="icr-search">
              <Search size={17} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contract, supplier, material..." />
              {search && <button onClick={() => setSearch("")} aria-label="Clear search"><X size={15} /></button>}
            </label>
          </div>
          <div className="icr-toolbar-right">
            <label className="icr-filter-label"><Filter size={15} /><span>Status</span></label>
            <select className="icr-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option>All</option>
              <option>Draft</option>
              <option>Pending Review</option>
              <option>Confirmed</option>
            </select>
            <select className="icr-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort contracts">
              <option value="newest">Newest first</option>
              <option value="supplier">Supplier A–Z</option>
              <option value="value">Highest value</option>
            </select>
          </div>
        </div>

        <div className="icr-table-wrap">
          <table className="icr-table">
            <thead>
              <tr>
                <th>Import ID / Contract</th>
                <th>Supplier</th>
                <th>Material</th>
                <th>Quantity</th>
                <th>Unit price</th>
                <th>Contract value</th>
                <th>Shipment</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9}><div className="icr-loading"><Loader2 className="icr-spinner" size={22} /> Loading contracts…</div></td></tr>
              ) : filteredContracts.length === 0 ? (
                <tr><td colSpan={9}>
                  <div className="icr-empty">
                    <div className="icr-empty-icon"><FileText size={25} /></div>
                    <strong>{contracts.length ? "No matching contracts" : "No contracts yet"}</strong>
                    <p>{contracts.length ? "Try changing your search or filters." : "Upload a contract to start extracting and reviewing details."}</p>
                    {!contracts.length && <button className="icr-btn icr-btn-primary" onClick={() => setUploadOpen(true)}><Upload size={16} /> Upload first contract</button>}
                  </div>
                </td></tr>
              ) : filteredContracts.map((contract) => (
                <tr key={contract.id}>
                  <td>
                    <div className="icr-contract-no">{contract.importId || "Pending confirmation"}</div>
                    <div className="icr-contract-title">{contract.fields.contractNumber || "Contract number missing"}</div>
                    <div className="icr-date">{contract.fields.contractDate || "Date not provided"}</div>
                  </td>
                  <td><div className="icr-supplier">{contract.fields.supplierName || "Unknown supplier"}</div><div className="icr-date">{contract.fields.supplierCountry}</div></td>
                  <td><div className="icr-contract-title">{contract.fields.productMaterialName || "Not extracted"}</div></td>
                  <td>{contract.fields.quantity ? `${contract.fields.quantity} ${contract.fields.uom}` : "—"}</td>
                  <td>{contract.fields.unitPrice ? `${contract.fields.currency} ${contract.fields.unitPrice}` : "—"}</td>
                  <td><strong>{contract.fields.currency} {contractValue(contract)}</strong></td>
                  <td>{contract.fields.shipmentDatePeriod || "—"}</td>
                  <td><span className={`icr-status ${STATUS_CLASS[contract.status]}`}>{contract.status}</span></td>
                  <td>
                    <div className="icr-actions">
                      <button className="icr-icon-btn" title="View details" onClick={() => setDetailContract(contract)}><Eye size={16} /></button>
                      <button className="icr-icon-btn" title="Edit contract" onClick={() => { setEditError(""); setEditContract(contract); }}><Pencil size={16} /></button>
                      <Link href={`/import/contracts/${contract.id}`} className="icr-icon-btn" title="Settlement sheet"><FileSpreadsheet size={16} /></Link>
                      {contract.status !== "Confirmed" && <button className="icr-icon-btn" title="Confirm this contract" onClick={async () => {
                        const r = await fetch(`/api/import-contracts/${encodeURIComponent(contract.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
                        const j = await r.json().catch(() => ({}));
                        if (!r.ok) { notify(errorMessage(j, "Could not confirm this contract.")); return; }
                        notify(j.importRecord ? `Confirmed — import record ${j.importRecord} created.` : "Contract confirmed.");
                        await fetchContracts(true);
                      }}><Check size={16} /></button>}
                      <button className="icr-icon-btn" title="Download original" onClick={() => downloadOriginal(contract)}><Download size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="icr-table-footer">
          <span>Showing {filteredContracts.length} of {contracts.length} contracts</span>
          <span><ShieldCheck size={14} /> Data shown is returned by the contract API</span>
        </div>
      </section>

      {/* Upload and extraction */}
      {uploadOpen && (
        <div className="icr-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !extracting) setUploadOpen(false); }}>
          <section className="icr-modal icr-modal-wide" role="dialog" aria-modal="true" aria-labelledby="icr-upload-title">
            <div className="icr-modal-header">
              <div><span className="icr-modal-kicker">STEP 1 OF 2</span><h2 id="icr-upload-title">Upload import contracts</h2><p>Upload original files for extraction and manual verification.</p></div>
              <button className="icr-icon-btn" onClick={() => setUploadOpen(false)} disabled={extracting} aria-label="Close"><X size={19} /></button>
            </div>
            <div className="icr-modal-body">
              {(currentReview?.duplicateOf || currentReview?.duplicateInBatch) && (
  <div className="icr-alert icr-alert-warning">
    <AlertCircle size={18} />

    <div>
      <strong>Possible duplicate contract detected</strong>

      {currentReview.duplicateOf && (
        <div>
          <p>
            An identical contract already exists in the database.
          </p>

          <p>
            <strong>Import ID:</strong>{" "}
            {currentReview.duplicateOf.importId ||
              currentReview.duplicateOf.id}
          </p>

          <p>
            <strong>Contract number:</strong>{" "}
            {currentReview.duplicateOf.contractNumber || "Not available"}
          </p>

          <p>
            <strong>Supplier:</strong>{" "}
            {currentReview.duplicateOf.supplierName || "Not available"}
          </p>
        </div>
      )}

      {currentReview.duplicateInBatch && (
        <p>
          Another uploaded file in this batch has matching business details:
          {" "}{currentReview.duplicateInBatch}
        </p>
      )}

      <p>
        Please verify this contract before proceeding.
      </p>
    </div>
  </div>
)}
              <button type="button" className="icr-upload-zone" onClick={() => fileInputRef.current?.click()} disabled={extracting}>
                <span className="icr-upload-icon"><Upload size={25} /></span>
                <strong>Choose contract documents</strong>
                <span>PDF, scanned PDF, JPG or PNG · Multiple files supported</span>
                <span className="icr-upload-cta">Browse files</span>
              </button>
              <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple hidden onChange={chooseFiles} />
              {files.length > 0 && (
                <div className="icr-file-list">
                  <div className="icr-file-list-header"><strong>{files.length} file(s) selected</strong><button className="icr-text-button" onClick={() => setFiles([])}>Remove all</button></div>
                  {files.map((file, index) => (
                    <div className="icr-file-row" key={`${file.name}-${file.size}-${index}`}>
                      <span className="icr-file-type">{file.type.startsWith("image/") ? <FileImage size={18} /> : <FileText size={18} />}</span>
                      <span className="icr-file-name"><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span>
                      <button className="icr-icon-btn" onClick={() => setFiles((previous) => previous.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`}><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="icr-info-note"><CircleHelp size={17} /><span>Only information supported by the document should be extracted. Missing or uncertain values must remain flagged for review.</span></div>
              {uploadError && <div className="icr-inline-error"><AlertCircle size={16} />{uploadError}</div>}
            </div>
            <div className="icr-modal-footer">
              <button className="icr-btn icr-btn-outline" onClick={() => setUploadOpen(false)} disabled={extracting}>Cancel</button>
              <button className="icr-btn icr-btn-primary" onClick={startExtraction} disabled={extracting || !files.length}>
                {extracting ? <><Loader2 size={16} className="icr-spinner" /> Processing documents…</> : <><Sparkles size={16} /> Extract & review</>}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Extraction review queue */}
      {reviewOpen && currentReview && (
        <div className="icr-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !savingReview) setReviewOpen(false); }}>
          <section className="icr-modal icr-modal-review" role="dialog" aria-modal="true" aria-labelledby="icr-review-title">
            <div className="icr-modal-header">
              <div><span className="icr-modal-kicker">STEP 2 OF 2 · AI EXTRACTION REVIEW</span><h2 id="icr-review-title">Review extracted contract</h2><p>Verify the extracted details against the original document before confirming.</p></div>
              <button type="button" className="icr-btn icr-btn-outline" onClick={() => setCompareOpen(true)} disabled={!currentReview.documentPath}><Eye size={16} /> Compare</button>
              <button className="icr-icon-btn" onClick={() => setReviewOpen(false)} disabled={savingReview} aria-label="Close"><X size={19} /></button>
            </div>
            <div className="icr-review-progress">
              <span>Document {reviewIndex + 1} of {reviewQueue.length}</span>
              <div className="icr-progress-track"><span style={{ width: `${((reviewIndex + 1) / reviewQueue.length) * 100}%` }} /></div>
              <span>{currentReview.documentName || "Uploaded document"}</span>
            </div>
            <div className="icr-modal-body">
              {(currentReview.warnings?.length ?? 0) > 0 && <div className="icr-alert icr-alert-warning"><AlertCircle size={18} /><div><strong>Validation warnings</strong>{currentReview.warnings?.map((warning, i) => <p key={i}>{warning}</p>)}</div></div>}
              <div className="icr-info-note"><Sparkles size={17} /><span>Highlighted fields are missing or marked uncertain by the extraction service. Verify them using the original contract.</span></div>

              {FIELD_GROUPS.map((group) => (
                <section className="icr-review-section" key={group.title}>
                  <h3>{group.title}</h3>
                  <div className="icr-form-grid">
                    {group.fields.map((field) => {
                      const flagged = isFlagged(field.key, currentReview);
                      const value = textValue(currentReview.fields[field.key]);
                      return (
                        <label className={`icr-field ${flagged ? "icr-field-flagged" : ""} ${field.key === "otherConditions" ? "icr-field-full" : ""}`} key={field.key}>
                          <span>{field.label}{flagged && <em>Needs review</em>}</span>
                          {field.key === "otherConditions" ? (
                            <textarea rows={3} value={value} placeholder="No value will be inferred if absent" onChange={(e) => updateReviewField(field.key, e.target.value)} />
                          ) : field.key === "uom" ? (
                            <select value={value} onChange={(e) => updateReviewField(field.key, e.target.value)}>
                              <option value="">Not specified</option><option value="MT">MT</option><option value="KG">KG</option>
                            </select>
                          ) : (
                            <input
                              type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                              step={field.type === "number" ? "any" : undefined}
                              value={value}
                              placeholder={field.placeholder || "Not specified in document"}
                              onChange={(e) => updateReviewField(field.key, e.target.value)}
                            />
                          )}
                          {flagged && <small>Verify this value from the source document. Do not guess.</small>}
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}

              <section className="icr-review-section">
                <div className="icr-section-heading-row"><div><h3>Material line items</h3><p>Each material is saved as a separate line under the same contract.</p></div><button className="icr-btn icr-btn-outline icr-btn-small" onClick={addMaterial}><Plus size={15} /> Add material</button></div>
                {currentReview.materials.map((material, index) => (
                  <div className="icr-material-card" key={index}>
                    <div className="icr-material-card-heading"><strong><Package size={16} /> Material {index + 1}</strong>{currentReview.materials.length > 1 && <button className="icr-text-button icr-danger-text" onClick={() => removeMaterial(index)}><Trash2 size={14} /> Remove</button>}</div>
                    <div className="icr-form-grid">
                      {([
                        ["materialName", "Material name", "text"],
                        ["gradeDescription", "Grade / description", "text"],
                        ["quantity", "Quantity", "number"],
                        ["uom", "UOM", "select"],
                        ["unitPrice", "Unit price", "number"],
                        ["currency", "Currency", "text"],
                        ["contractValue", "Line contract value", "number"],
                      ] as const).map(([key, label, type]) => (
                        <label className="icr-field" key={key}>
                          <span>{label}</span>
                          {type === "select" ? (
                            <select value={material[key]} onChange={(e) => updateReviewMaterial(index, key, e.target.value)}>
                              <option value="">Not specified</option><option value="MT">MT</option><option value="KG">KG</option>
                            </select>
                          ) : (
                            <input type={type} step={type === "number" ? "any" : undefined} value={material[key]} onChange={(e) => updateReviewMaterial(index, key, e.target.value)} />
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </section>

            <InlineOriginalPreview
  documentName={currentReview.documentName || "Original contract"}
  documentPath={currentReview.documentPath}
/>
<p style={{ fontSize: 12, color: "red" }}>
  Document path: {currentReview.documentPath || "MISSING"}
</p>
              {reviewError && <div className="icr-inline-error"><AlertCircle size={16} />{reviewError}</div>}
            </div>
            <div className="icr-modal-footer icr-modal-footer-between">
              <div className="icr-footer-left">
                {reviewQueue.length > 1 && <span className="icr-muted-text">Review every uploaded document before finishing.</span>}
              </div>
              <div className="icr-footer-actions">
                {reviewIndex > 0 && <button className="icr-btn icr-btn-outline" disabled={savingReview} onClick={() => setReviewIndex((i) => i - 1)}><ArrowLeft size={16} /> Previous</button>}
                {reviewIndex < reviewQueue.length - 1 && <button className="icr-btn icr-btn-outline" disabled={savingReview} onClick={() => setReviewIndex((i) => i + 1)}>Next document <ArrowRight size={16} /></button>}
                <button className="icr-btn icr-btn-primary" disabled={savingReview} onClick={confirmCurrentContract}>
                  {savingReview ? <><Loader2 size={16} className="icr-spinner" /> Saving…</> : <><Check size={16} /> Confirm & create</>}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Read-only contract details */}
      {detailContract && (
        <div className="icr-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetailContract(null); }}>
          <section className="icr-modal icr-modal-wide" role="dialog" aria-modal="true" aria-labelledby="icr-detail-title">
            <div className="icr-modal-header">
              <div><span className="icr-modal-kicker">CONTRACT RECORD</span><h2 id="icr-detail-title">{detailContract.fields.contractNumber || "Import contract details"}</h2><p>{detailContract.importId || "Import ID will be assigned after confirmation"}</p></div>
              <button className="icr-icon-btn" onClick={() => setDetailContract(null)} aria-label="Close"><X size={19} /></button>
            </div>
            <div className="icr-modal-body">
              <div className="icr-detail-status-row"><span className={`icr-status ${STATUS_CLASS[detailContract.status]}`}>{detailContract.status}</span><span className="icr-date">Created: {detailContract.createdAt ? new Date(detailContract.createdAt).toLocaleString() : "Not supplied"}</span></div>
              {FIELD_GROUPS.map((group) => (
                <section className="icr-review-section" key={group.title}>
                  <h3>{group.title}</h3>
                  <div className="icr-detail-grid">
                    {group.fields.map((field) => (
                      <div className="icr-detail" key={field.key}>
                        <span className="icr-detail-label">{field.label}</span>
                        <strong className="icr-detail-value">{textValue(detailContract.fields[field.key]) || "—"}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              {detailContract.materials.length > 0 && <section className="icr-review-section"><h3>Material line items</h3><div className="icr-material-list">{detailContract.materials.map((m, i) => <div className="icr-material-summary" key={i}><strong>{i + 1}. {m.materialName || "Material not specified"}</strong><span>{m.gradeDescription || "—"}</span><span>Qty: {m.quantity || "—"} {m.uom}</span><span>Unit price: {m.currency} {m.unitPrice || "—"}</span><span>Value: {m.currency} {m.contractValue || "—"}</span></div>)}</div></section>}
              {detailContract.warnings?.length ? <div className="icr-alert icr-alert-warning"><AlertCircle size={18} /><div><strong>Validation warnings</strong>{detailContract.warnings.map((w, i) => <p key={i}>{w}</p>)}</div></div> : null}
              <section className="icr-review-section">
                <h3><History size={17} /> History</h3>
                {detailContract.history?.length ? detailContract.history.map((item, i) => <div className="icr-history-row" key={i}><span className="icr-history-dot" /><div><strong>{item.action}</strong><small>{item.by || "System"} · {item.at ? new Date(item.at).toLocaleString() : "Timestamp not supplied"}</small></div></div>) : <p className="icr-muted-text">No history entries were returned by the API.</p>}
              </section>
              

<InlineOriginalPreview
  documentName={detailContract.documentName || "Original contract"}
  documentPath={detailContract.documentPath}
/>


            </div>
            <div className="icr-modal-footer"><button className="icr-btn icr-btn-outline" onClick={() => setDetailContract(null)}>Close</button><button className="icr-btn icr-btn-primary" onClick={() => { setEditError(""); setEditContract(detailContract); setDetailContract(null); }}><Pencil size={16} /> Edit contract</button></div>
          </section>
        </div>
      )}

      {/* Edit existing record */}
      {editContract && (
        <div className="icr-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !savingEdit) setEditContract(null); }}>
          <section className="icr-modal icr-modal-wide" role="dialog" aria-modal="true" aria-labelledby="icr-edit-title">
            <div className="icr-modal-header"><div><span className="icr-modal-kicker">EDIT RECORD</span><h2 id="icr-edit-title">Edit import contract</h2><p>Changes should be recorded in the server-side audit history.</p></div><button className="icr-icon-btn" onClick={() => setEditContract(null)} disabled={savingEdit} aria-label="Close"><X size={19} /></button></div>
            <div className="icr-modal-body">
               
              {FIELD_GROUPS.map((group) => <section className="icr-review-section" key={group.title}><h3>{group.title}</h3><div className="icr-form-grid">{group.fields.map((field) => <label className={`icr-field ${field.key === "otherConditions" ? "icr-field-full" : ""}`} key={field.key}><span>{field.label}</span>{field.key === "otherConditions" ? <textarea rows={3} value={textValue(editContract.fields[field.key])} onChange={(e) => setEditContract({ ...editContract, fields: { ...editContract.fields, [field.key]: e.target.value } })} /> : field.key === "uom" ? <select value={textValue(editContract.fields[field.key])} onChange={(e) => setEditContract({ ...editContract, fields: { ...editContract.fields, [field.key]: e.target.value } })}><option value="">Not specified</option><option value="MT">MT</option><option value="KG">KG</option></select> : <input type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} step={field.type === "number" ? "any" : undefined} value={textValue(editContract.fields[field.key])} onChange={(e) => setEditContract({ ...editContract, fields: { ...editContract.fields, [field.key]: e.target.value } })} />}</label>)}</div></section>)}
              <section className="icr-review-section"><div className="icr-section-heading-row"><div><h3>Material line items</h3><p>Material details can be updated individually.</p></div><button className="icr-btn icr-btn-outline icr-btn-small" onClick={() => setEditContract({ ...editContract, materials: [...editContract.materials, { materialName: "", gradeDescription: "", quantity: "", uom: "", unitPrice: "", currency: editContract.fields.currency, contractValue: "" }] })}><Plus size={15} /> Add material</button></div>
              {editContract.materials.map((m, index) => (<div className="icr-material-card" key={index}><div className="icr-material-card-heading"><strong>Material {index + 1}</strong><button className="icr-text-button icr-danger-text" onClick={() => setEditContract({ ...editContract, materials: editContract.materials.filter((_, i) => i !== index) })}><Trash2 size={14} /> Remove</button></div><div className="icr-form-grid">{(["materialName", "gradeDescription", "quantity", "uom", "unitPrice", "currency", "contractValue"] as (keyof MaterialLine)[]).map((key) => (<label className="icr-field" key={key}><span>{({ materialName: "Material name", gradeDescription: "Grade / description", quantity: "Quantity", uom: "UOM", unitPrice: "Unit price", currency: "Currency", contractValue: "Line value" })[key]}</span>{key === "uom" ? (<select value={m.uom} onChange={(e) => { const value = e.target.value; if (value !== "" && value !== "MT" && value !== "KG") return; setEditContract({ ...editContract, materials: editContract.materials.map((row, i) => i === index ? { ...row, uom: value } : row) }); }}><option value="">Not specified</option><option value="MT">MT</option><option value="KG">KG</option></select>) : (<input type={["quantity", "unitPrice", "contractValue"].includes(key) ? "number" : "text"} step={["quantity", "unitPrice", "contractValue"].includes(key) ? "any" : undefined} value={m[key]} onChange={(e) => setEditContract({ ...editContract, materials: editContract.materials.map((row, i) => i === index ? { ...row, [key]: e.target.value } : row) })} />)}</label>))}</div></div>))}
              </section>
              {editError && <div className="icr-inline-error"><AlertCircle size={16} />{editError}</div>}
              <InlineOriginalPreview
          documentName={editContract.documentName || "Original contract"}
          documentPath={editContract.documentPath}
        />
            </div>
             
            <div className="icr-modal-footer"><button className="icr-btn icr-btn-outline" onClick={() => setEditContract(null)} disabled={savingEdit}>Cancel</button><button className="icr-btn icr-btn-primary" onClick={saveEditedContract} disabled={savingEdit}>{savingEdit ? <><Loader2 size={16} className="icr-spinner" /> Saving…</> : <><Check size={16} /> Save changes</>}</button></div>
          </section>
        </div>
      )}
      
{compareOpen && reviewOpen && currentReview && (
  <ContractComparePanel
    documentName={
      currentReview.documentName || "Original contract"
    }
    documentPath={currentReview.documentPath || ""}
    fields={
      currentReview.fields as Record<
        string,
        string | number | boolean | null
      >
    }
    onFieldsChange={(fields) => {
      setReviewQueue((previous) =>
        previous.map((contract, index) =>
          index === reviewIndex
            ? {
                ...contract,
                fields: {
                  ...contract.fields,
                  ...fields,
                } as ContractFields,
              }
            : contract
        )
      );
    }}
    onClose={() => setCompareOpen(false)}
  />
)}

      {toast && <div className="icr-toast"><CheckCircle2 size={17} />{toast}</div>}
    </main>
  );
}
