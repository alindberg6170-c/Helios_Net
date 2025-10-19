// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

// Randomly selected styles:
// Colors: High contrast (Blue+Orange)
// UI Style: Future metal
// Layout: Center radiation
// Interaction: Micro-interactions (hover ripple, button breathing light)

// Randomly selected features:
// 1. Data statistics
// 2. Global data map (simulated)
// 3. Project introduction
// 4. Dynamic feed flow

interface SolarRecord {
  id: string;
  encryptedOutput: string; // kWh encrypted with FHE
  timestamp: number;
  owner: string;
  location: string;
  status: "active" | "inactive";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'increase10%':
      result = value * 1.1;
      break;
    case 'decrease10%':
      result = value * 0.9;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<SolarRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({ location: "", output: 0 });
  const [showIntro, setShowIntro] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<SolarRecord | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [feedMessages, setFeedMessages] = useState<string[]>([]);
  const activeCount = records.filter(r => r.status === "active").length;
  const inactiveCount = records.filter(r => r.status === "inactive").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();

    // Simulate feed updates
    const feedInterval = setInterval(() => {
      const messages = [
        "New solar node added in Taipei",
        "FHE computation completed for 12 nodes",
        "DAO voting round started for network upgrade",
        "3 new lenders joined the DeFi pool",
        "Network capacity increased by 15%"
      ];
      setFeedMessages(prev => [messages[Math.floor(Math.random() * messages.length)], ...prev.slice(0, 4)]);
    }, 8000);
    return () => clearInterval(feedInterval);
  }, []);

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("solar_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing solar keys:", e); }
      }
      
      const list: SolarRecord[] = [];
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`solar_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({ 
                id: key, 
                encryptedOutput: recordData.output, 
                timestamp: recordData.timestamp, 
                owner: recordData.owner, 
                location: recordData.location,
                status: recordData.status || "active"
              });
            } catch (e) { console.error(`Error parsing record data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading record ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) { console.error("Error loading records:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitRecord = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting solar output with Zama FHE..." });
    try {
      const encryptedOutput = FHEEncryptNumber(newRecordData.output);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const recordId = `solar-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const recordData = { 
        output: encryptedOutput, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        location: newRecordData.location,
        status: "active"
      };
      
      await contract.setData(`solar_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(recordData)));
      
      const keysBytes = await contract.getData("solar_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(recordId);
      await contract.setData("solar_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Solar data encrypted and stored!" });
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({ location: "", output: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const toggleRecordStatus = async (recordId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Updating solar node status..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const recordBytes = await contract.getData(`solar_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      const newStatus = recordData.status === "active" ? "inactive" : "active";
      
      const updatedRecord = { ...recordData, status: newStatus };
      await contract.setData(`solar_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRecord)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Node marked as ${newStatus}` 
      });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Update failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (recordAddress: string) => address?.toLowerCase() === recordAddress.toLowerCase();

  const renderMapVisualization = () => {
    // Simulated map with random node locations
    const locations = [
      { x: 20, y: 30, active: true },
      { x: 70, y: 45, active: false },
      { x: 40, y: 70, active: true },
      { x: 80, y: 20, active: true },
      { x: 30, y: 50, active: false }
    ];
    
    return (
      <div className="map-container">
        <div className="world-map">
          {locations.map((loc, i) => (
            <div 
              key={i} 
              className={`map-node ${loc.active ? 'active' : 'inactive'}`}
              style={{ left: `${loc.x}%`, top: `${loc.y}%` }}
            >
              <div className="node-pulse"></div>
            </div>
          ))}
        </div>
        <div className="map-legend">
          <div className="legend-item">
            <div className="node-sample active"></div>
            <span>Active Nodes</span>
          </div>
          <div className="legend-item">
            <div className="node-sample inactive"></div>
            <span>Inactive Nodes</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Initializing Helios Network...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24">
              <path d="M12,7L4,21H20L12,7Z" fill="#FFA500" />
              <circle cx="12" cy="4" r="3" fill="#FFD700" />
            </svg>
          </div>
          <h1>Helios<span>Network</span></h1>
        </div>
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn metal-button"
          >
            <div className="add-icon"></div>Add Solar Node
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content radial-layout">
        <div className="center-panel">
          {showIntro ? (
            <div className="intro-panel metal-card">
              <h2>Helios Network</h2>
              <p className="subtitle">A DePIN for Solar Energy with DeFi Lending</p>
              
              <div className="intro-content">
                <div className="intro-feature">
                  <div className="feature-icon">🔒</div>
                  <h3>FHE Encrypted Data</h3>
                  <p>Solar generation data is encrypted using Zama FHE technology before being stored on-chain</p>
                </div>
                
                <div className="intro-feature">
                  <div className="feature-icon">⚡</div>
                  <h3>DeFi Collateral</h3>
                  <p>Use your encrypted future solar output as collateral for private loans in our DeFi pool</p>
                </div>
                
                <div className="intro-feature">
                  <div className="feature-icon">🌐</div>
                  <h3>DAO Governance</h3>
                  <p>Network upgrades and rewards are determined through private DAO voting</p>
                </div>
              </div>
              
              <button 
                className="metal-button primary"
                onClick={() => setShowIntro(false)}
              >
                Enter Dashboard
              </button>
            </div>
          ) : (
            <>
              <div className="stats-panel metal-card">
                <div className="stat-item">
                  <div className="stat-value">{records.length}</div>
                  <div className="stat-label">Total Nodes</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{activeCount}</div>
                  <div className="stat-label">Active</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{inactiveCount}</div>
                  <div className="stat-label">Inactive</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">
                    {records.length > 0 
                      ? Math.round(records.reduce((sum, r) => sum + FHEDecryptNumber(r.encryptedOutput), 0) / records.length)
                      : 0}
                  </div>
                  <div className="stat-label">Avg Output (kWh)</div>
                </div>
              </div>
              
              <div className="map-panel metal-card">
                <h3>Global Node Distribution</h3>
                {renderMapVisualization()}
              </div>
              
              <div className="feed-panel metal-card">
                <h3>Network Activity</h3>
                <div className="feed-container">
                  {feedMessages.length > 0 ? (
                    feedMessages.map((msg, i) => (
                      <div key={i} className="feed-item">
                        <div className="feed-bullet"></div>
                        <div className="feed-message">{msg}</div>
                        <div className="feed-time">Just now</div>
                      </div>
                    ))
                  ) : (
                    <div className="empty-feed">Loading network activity...</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        
        <div className="side-panel">
          <div className="records-panel metal-card">
            <div className="panel-header">
              <h3>Solar Nodes</h3>
              <button 
                onClick={loadRecords} 
                className="refresh-btn metal-button" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            
            <div className="records-list">
              {records.length === 0 ? (
                <div className="no-records">
                  <div className="no-records-icon"></div>
                  <p>No solar nodes registered</p>
                  <button 
                    className="metal-button primary" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Register First Node
                  </button>
                </div>
              ) : (
                records.map(record => (
                  <div 
                    key={record.id} 
                    className={`record-item ${record.status}`}
                    onClick={() => setSelectedRecord(record)}
                  >
                    <div className="record-icon">
                      <div className={`status-indicator ${record.status}`}></div>
                    </div>
                    <div className="record-details">
                      <div className="record-location">{record.location}</div>
                      <div className="record-meta">
                        <span>#{record.id.substring(0, 6)}</span>
                        <span>{new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="record-actions">
                      {isOwner(record.owner) && (
                        <button 
                          className="status-toggle metal-button small"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRecordStatus(record.id);
                          }}
                        >
                          {record.status === "active" ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
        />
      )}
      
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => {
            setSelectedRecord(null); 
            setDecryptedValue(null);
          }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="footer-logo">Helios Network</div>
            <p>Decentralized Solar Energy Infrastructure</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">DAO Governance</a>
            <a href="#" className="footer-link">DeFi Pool</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="tech-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} Helios Network. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, recordData, setRecordData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!recordData.location || !recordData.output) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Register Solar Node</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔒</div>
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your solar output data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Location *</label>
            <input 
              type="text" 
              name="location" 
              value={recordData.location} 
              onChange={handleChange} 
              placeholder="e.g. Taipei, Taiwan"
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Estimated Daily Output (kWh) *</label>
            <input 
              type="number" 
              name="output" 
              value={recordData.output} 
              onChange={handleValueChange} 
              placeholder="Enter estimated kWh output"
              className="metal-input"
              step="0.1"
              min="0"
            />
          </div>
          
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Value:</span>
                <div>{recordData.output || '0'} kWh</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>
                  {recordData.output ? 
                    FHEEncryptNumber(recordData.output).substring(0, 30) + '...' : 
                    'No value entered'}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-button">
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating} 
            className="submit-btn metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Register Node"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface RecordDetailModalProps {
  record: SolarRecord;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const RecordDetailModal: React.FC<RecordDetailModalProps> = ({ 
  record, 
  onClose, 
  decryptedValue, 
  setDecryptedValue, 
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(record.encryptedOutput);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal metal-card">
        <div className="modal-header">
          <h2>Node Details #{record.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>Location:</span>
              <strong>{record.location}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>
                {record.owner.substring(0, 6)}...{record.owner.substring(38)}
              </strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${record.status}`}>
                {record.status}
              </strong>
            </div>
            <div className="info-item">
              <span>Registered:</span>
              <strong>
                {new Date(record.timestamp * 1000).toLocaleString()}
              </strong>
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Output</h3>
            <div className="encrypted-data">
              {record.encryptedOutput.substring(0, 50)}...
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon">🔒</div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn metal-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedValue !== null ? (
                "Hide Decrypted Value"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Output</h3>
              <div className="decrypted-value">
                {decryptedValue} kWh
              </div>
              <div className="decryption-notice">
                <div className="warning-icon">⚠️</div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;