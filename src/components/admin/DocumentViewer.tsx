'use client'

import { FileText, Download, ExternalLink } from 'lucide-react'
import { useState } from 'react'

interface DocumentViewerProps {
  certificateUrl: string | null
  affidavitUrl: string | null
}

export default function DocumentViewer({ certificateUrl, affidavitUrl }: DocumentViewerProps) {
  const [activeTab, setActiveTab] = useState<'certificate' | 'affidavit'>('certificate')

  const currentUrl = activeTab === 'certificate' ? certificateUrl : affidavitUrl

  const tabs = [
    { key: 'certificate' as const, label: 'Certificate', available: !!certificateUrl },
    { key: 'affidavit' as const, label: 'Affidavit', available: !!affidavitUrl },
  ]

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e5e5', marginBottom: 12 }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #335231' : '2px solid transparent',
              color: activeTab === tab.key ? '#335231' : '#999',
              fontWeight: activeTab === tab.key ? 600 : 400,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <FileText size={14} />
            {tab.label}
            {!tab.available && (
              <span
                style={{
                  fontSize: 10,
                  background: '#f0f0f0',
                  color: '#999',
                  padding: '1px 6px',
                  borderRadius: 8,
                }}
              >
                Missing
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Document display */}
      {currentUrl ? (
        <div>
          <div
            style={{
              width: '100%',
              height: 400,
              borderRadius: 8,
              border: '1px solid #e5e5e5',
              overflow: 'hidden',
              background: '#fafafa',
            }}
          >
            {currentUrl.match(/\.(pdf)$/i) ? (
              <iframe
                src={currentUrl}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title={activeTab}
              />
            ) : (
              // A signed storage URL to claim evidence: it must not pass through
              // the image optimizer (which would cache it), so a plain <img>.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentUrl}
                alt={activeTab}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid #e5e5e5',
                background: '#fff',
                fontSize: 13,
                textDecoration: 'none',
                color: '#333',
              }}
            >
              <ExternalLink size={14} />
              Open in new tab
            </a>
            <a
              href={currentUrl}
              download
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid #e5e5e5',
                background: '#fff',
                fontSize: 13,
                textDecoration: 'none',
                color: '#333',
              }}
            >
              <Download size={14} />
              Download
            </a>
          </div>
        </div>
      ) : (
        <div
          style={{
            width: '100%',
            height: 200,
            background: '#f8f8f8',
            borderRadius: 8,
            border: '1px dashed #ddd',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
            color: '#999',
          }}
        >
          <FileText size={32} color="#ccc" />
          <span style={{ fontSize: 14 }}>
            {activeTab === 'certificate' ? 'Certificate' : 'Affidavit'} not yet uploaded
          </span>
        </div>
      )}
    </div>
  )
}
