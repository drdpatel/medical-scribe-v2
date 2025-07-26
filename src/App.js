import React, { useState, useRef, useEffect } from 'react';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import axios from 'axios';

function App() {
  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [medicalNotes, setMedicalNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('Ready to record - Configure API settings first');
  
  // Patient management states
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [newPatient, setNewPatient] = useState({ name: '', dob: '', mrn: '', conditions: '' });
  
  // AI Training states
  const [aiPreferences, setAiPreferences] = useState({
    noteStyle: 'standard',
    includeAssessment: true,
    includePlan: true,
    customInstructions: ''
  });
  const [showPreferences, setShowPreferences] = useState(false);
  
  // API Settings states
  const [apiSettings, setApiSettings] = useState({
    speechKey: '',
    speechRegion: 'eastus',
    openaiEndpoint: '',
    openaiKey: '',
    openaiDeployment: 'gpt-4.1',
    openaiApiVersion: '2024-08-01-preview'
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  
  const recognizerRef = useRef(null);
  const audioConfigRef = useRef(null);

  // Load data from localStorage on app start
  useEffect(() => {
    try {
      const savedPatients = localStorage.getItem('medicalScribePatients');
      const savedPreferences = localStorage.getItem('medicalScribePreferences');
      const savedApiSettings = localStorage.getItem('medicalScribeApiSettings');
      
      if (savedPatients) {
        setPatients(JSON.parse(savedPatients));
      }
      
      if (savedPreferences) {
        setAiPreferences(JSON.parse(savedPreferences));
      }
      
      if (savedApiSettings) {
        const settings = JSON.parse(savedApiSettings);
        setApiSettings(settings);
        // Update status if API keys are configured
        if (settings.speechKey && settings.openaiKey) {
          setStatus('Ready to record');
        }
      }
    } catch (error) {
      console.warn('LocalStorage not available, using memory storage');
    }
  }, []);

  // Save patients to localStorage
  const savePatients = (updatedPatients) => {
    setPatients(updatedPatients);
    try {
      localStorage.setItem('medicalScribePatients', JSON.stringify(updatedPatients));
    } catch (error) {
      console.warn('Cannot save to localStorage');
    }
  };

  // Save AI preferences
  const savePreferences = (prefs) => {
    setAiPreferences(prefs);
    try {
      localStorage.setItem('medicalScribePreferences', JSON.stringify(prefs));
    } catch (error) {
      console.warn('Cannot save preferences to localStorage');
    }
  };

  // Save API settings
  const saveApiSettings = (settings) => {
    setApiSettings(settings);
    try {
      localStorage.setItem('medicalScribeApiSettings', JSON.stringify(settings));
    } catch (error) {
      console.warn('Cannot save API settings to localStorage');
    }
  };

  // Add new patient
  const addPatient = () => {
    if (!newPatient.name.trim()) {
      alert('Patient name is required');
      return;
    }
    
    const patient = {
      id: Date.now(),
      ...newPatient,
      visits: [],
      createdAt: new Date().toISOString()
    };
    
    savePatients([...patients, patient]);
    setNewPatient({ name: '', dob: '', mrn: '', conditions: '' });
    setShowAddPatient(false);
    setStatus(`✅ Patient ${patient.name} added successfully`);
  };

  // Select patient for current session
  const selectPatient = (patient) => {
    setSelectedPatient(patient);
    setStatus(`📋 Selected patient: ${patient.name}`);
  };

  // Save visit notes to patient record
  const saveVisitToPatient = () => {
    if (!selectedPatient || !medicalNotes.trim()) {
      setStatus('❌ Please select a patient and generate notes first');
      return;
    }

    const visit = {
      id: Date.now(),
      date: new Date().toISOString(),
      transcript: transcript,
      notes: medicalNotes,
      timestamp: new Date().toLocaleString()
    };

    const updatedPatients = patients.map(p => 
      p.id === selectedPatient.id 
        ? { ...p, visits: [...p.visits, visit] }
        : p
    );

    savePatients(updatedPatients);
    setSelectedPatient(updatedPatients.find(p => p.id === selectedPatient.id));
    setStatus('✅ Visit notes saved to patient record');
  };

  const startRecording = async () => {
    // Check API settings - NO environment variables
    const speechKey = apiSettings.speechKey;
    const speechRegion = apiSettings.speechRegion;
    
    if (!speechKey || !speechRegion) {
      setStatus('❌ Please configure Azure Speech settings first (click 🔧 API Settings)');
      setShowSettings(true);
      return;
    }

    try {
      setStatus('🔧 Requesting microphone access...');
      
      // Request microphone permission explicitly
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (permError) {
        setStatus('❌ Microphone permission denied. Please allow microphone access.');
        return;
      }
      
      const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(speechKey, speechRegion);
      speechConfig.speechRecognitionLanguage = 'en-US';
      
      audioConfigRef.current = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfigRef.current);

      recognizerRef.current.recognizing = (s, e) => {
        if (e.result.text) {
          setTranscript(prev => prev + ' ' + e.result.text);
        }
      };

      recognizerRef.current.recognized = (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text) {
          setTranscript(prev => prev + ' ' + e.result.text);
        }
      };

      recognizerRef.current.sessionStopped = () => {
        setIsRecording(false);
        setStatus('✅ Recording session ended');
      };

      recognizerRef.current.startContinuousRecognitionAsync(
        () => {
          setIsRecording(true);
          setStatus('🔴 Recording... Speak now');
        },
        (error) => {
          console.error('Recognition start error:', error);
          setIsRecording(false);
          if (error.toString().includes('1006')) {
            setStatus('❌ Invalid Speech key. Check your Azure Speech Service key in API Settings.');
          } else if (error.toString().includes('1007')) {
            setStatus('❌ Speech service quota exceeded or region mismatch. Check API Settings.');
          } else {
            setStatus(`❌ Recording failed: ${error}`);
          }
        }
      );
      
    } catch (error) {
      console.error('Recording setup error:', error);
      setStatus(`❌ Setup failed: ${error.message}`);
    }
  };

  const stopRecording = () => {
    if (recognizerRef.current) {
      recognizerRef.current.stopContinuousRecognitionAsync(
        () => {
          setIsRecording(false);
          setStatus('✅ Recording complete');
        },
        (error) => {
          console.error('Stop recording error:', error);
          setIsRecording(false);
          setStatus('⚠️ Recording stopped with error');
        }
      );
      recognizerRef.current = null;
    } else {
      setIsRecording(false);
      setStatus('✅ Recording complete');
    }
  };

  const generateMedicalNotes = async () => {
    if (!transcript.trim()) {
      setStatus('❌ No transcript available. Please record first.');
      return;
    }

    // Check API settings - NO environment variables
    const openaiEndpoint = apiSettings.openaiEndpoint;
    const openaiKey = apiSettings.openaiKey;
    const deployment = apiSettings.openaiDeployment;
    const apiVersion = apiSettings.openaiApiVersion;

    if (!openaiEndpoint || !openaiKey || !deployment) {
      setStatus('❌ Please configure Azure OpenAI settings first (click 🔧 API Settings)');
      setShowSettings(true);
      return;
    }

    setIsProcessing(true);
    setStatus('🤖 AI generating medical notes...');

    try {
      // Build context from patient history
      let patientContext = '';
      if (selectedPatient) {
        patientContext = `
PATIENT CONTEXT:
Name: ${selectedPatient.name}
DOB: ${selectedPatient.dob}
MRN: ${selectedPatient.mrn}
Known Conditions: ${selectedPatient.conditions}

RECENT VISIT HISTORY:
${selectedPatient.visits.slice(-3).map(visit => 
  `${visit.timestamp}: ${visit.notes.substring(0, 200)}...`
).join('\n')}
`;
      }

      // Build AI instructions based on preferences
      let systemPrompt = `You are a medical scribe assistant specializing in obesity medicine. `;
      
      if (aiPreferences.noteStyle === 'detailed') {
        systemPrompt += `Create comprehensive, detailed medical notes. `;
      } else if (aiPreferences.noteStyle === 'concise') {
        systemPrompt += `Create concise, focused medical notes. `;
      } else {
        systemPrompt += `Create standard medical notes. `;
      }

      systemPrompt += `Include the following sections: `;
      if (aiPreferences.includeAssessment) systemPrompt += `Assessment, `;
      if (aiPreferences.includePlan) systemPrompt += `Plan, `;
      systemPrompt += `Chief Complaint, History of Present Illness. `;

      if (aiPreferences.customInstructions) {
        systemPrompt += `Additional instructions: ${aiPreferences.customInstructions} `;
      }

      systemPrompt += `Use appropriate medical terminology and maintain professional format.`;

      const response = await axios.post(
        `${openaiEndpoint}openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
        {
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: `${patientContext}

CURRENT VISIT TRANSCRIPT:
${transcript}

Please convert this into structured medical notes following the specified format and preferences.`
            }
          ],
          max_tokens: 1500,
          temperature: 0.3
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': openaiKey
          }
        }
      );

      setMedicalNotes(response.data.choices[0].message.content);
      setStatus('✅ Medical notes generated successfully');
      
    } catch (error) {
      console.error('AI generation error:', error);
      if (error.response?.status === 401) {
        setStatus('❌ OpenAI authentication failed. Check your API key in settings.');
      } else if (error.response?.status === 404) {
        setStatus('❌ OpenAI deployment not found. Check your deployment name in settings.');
      } else if (error.response?.status === 429) {
        setStatus('❌ OpenAI rate limit exceeded. Wait a moment and try again.');
      } else {
        setStatus('❌ Failed to generate notes: ' + (error.response?.data?.error?.message || error.message));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const clearCurrentSession = () => {
    setTranscript('');
    setMedicalNotes('');
    setStatus('Ready to record');
  };

  return (
    <div className="app">
      <div className="header">
        <h1>🏥 Medical Scribe AI</h1>
        <p>Obesity Medicine Assistant - AI-Powered Documentation with Patient Context</p>
        {selectedPatient && (
          <div style={{marginTop: '10px', padding: '10px', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '5px'}}>
            📋 Current Patient: <strong>{selectedPatient.name}</strong> | MRN: {selectedPatient.mrn} | Visits: {selectedPatient.visits.length}
          </div>
        )}
      </div>

      {/* Patient Management Panel */}
      <div className="control-panel">
        <h3>👥 Patient Management</h3>
        <div className="recording-controls">
          <button 
            className="btn" 
            onClick={() => setShowAddPatient(!showAddPatient)}
            style={{backgroundColor: '#3498db', color: 'white'}}
          >
            ➕ Add Patient
          </button>
          
          <button 
            className="btn" 
            onClick={() => setShowPreferences(!showPreferences)}
            style={{backgroundColor: '#9b59b6', color: 'white'}}
          >
            ⚙️ AI Preferences
          </button>
          
          <button 
            className="btn" 
            onClick={() => setShowSettings(!showSettings)}
            style={{backgroundColor: '#e74c3c', color: 'white'}}
          >
            🔧 API Settings
          </button>
          
          <select 
            onChange={(e) => selectPatient(patients.find(p => p.id == e.target.value))}
            style={{padding: '12px', borderRadius: '8px', border: '1px solid #ddd'}}
          >
            <option value="">Select Patient...</option>
            {patients.map(patient => (
              <option key={patient.id} value={patient.id}>
                {patient.name} ({patient.mrn}) - {patient.visits.length} visits
              </option>
            ))}
          </select>
        </div>

        {/* Add Patient Form */}
        {showAddPatient && (
          <div style={{marginTop: '20px', padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '8px'}}>
            <h4>Add New Patient</h4>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '15px'}}>
              <input
                type="text"
                placeholder="Patient Name"
                value={newPatient.name}
                onChange={(e) => setNewPatient({...newPatient, name: e.target.value})}
                style={{padding: '8px', borderRadius: '4px', border: '1px solid #ddd'}}
              />
              <input
                type="date"
                placeholder="Date of Birth"
                value={newPatient.dob}
                onChange={(e) => setNewPatient({...newPatient, dob: e.target.value})}
                style={{padding: '8px', borderRadius: '4px', border: '1px solid #ddd'}}
              />
              <input
                type="text"
                placeholder="MRN"
                value={newPatient.mrn}
                onChange={(e) => setNewPatient({...newPatient, mrn: e.target.value})}
                style={{padding: '8px', borderRadius: '4px', border: '1px solid #ddd'}}
              />
              <input
                type="text"
                placeholder="Known Conditions"
                value={newPatient.conditions}
                onChange={(e) => setNewPatient({...newPatient, conditions: e.target.value})}
                style={{padding: '8px', borderRadius: '4px', border: '1px solid #ddd'}}
              />
            </div>
            <button onClick={addPatient} className="btn" style={{backgroundColor: '#27ae60', color: 'white', marginRight: '10px'}}>
              Save Patient
            </button>
            <button onClick={() => setShowAddPatient(false)} className="btn" style={{backgroundColor: '#95a5a6', color: 'white'}}>
              Cancel
            </button>
          </div>
        )}

        {/* AI Preferences */}
        {showPreferences && (
          <div style={{marginTop: '20px', padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '8px'}}>
            <h4>🤖 AI Note Preferences</h4>
            <div style={{marginBottom: '15px'}}>
              <label style={{display: 'block', marginBottom: '5px'}}>Note Style:</label>
              <select 
                value={aiPreferences.noteStyle}
                onChange={(e) => setAiPreferences({...aiPreferences, noteStyle: e.target.value})}
                style={{padding: '8px', borderRadius: '4px', border: '1px solid #ddd', width: '200px'}}
              >
                <option value="standard">Standard</option>
                <option value="detailed">Detailed</option>
                <option value="concise">Concise</option>
              </select>
            </div>
            
            <div style={{marginBottom: '15px'}}>
              <label>
                <input 
                  type="checkbox" 
                  checked={aiPreferences.includeAssessment}
                  onChange={(e) => setAiPreferences({...aiPreferences, includeAssessment: e.target.checked})}
                  style={{marginRight: '8px'}}
                />
                Include Assessment Section
              </label>
            </div>
            
            <div style={{marginBottom: '15px'}}>
              <label>
                <input 
                  type="checkbox" 
                  checked={aiPreferences.includePlan}
                  onChange={(e) => setAiPreferences({...aiPreferences, includePlan: e.target.checked})}
                  style={{marginRight: '8px'}}
                />
                Include Plan Section
              </label>
            </div>
            
            <div style={{marginBottom: '15px'}}>
              <label style={{display: 'block', marginBottom: '5px'}}>Custom Instructions:</label>
              <textarea
                value={aiPreferences.customInstructions}
                onChange={(e) => setAiPreferences({...aiPreferences, customInstructions: e.target.value})}
                placeholder="e.g., Always include BMI calculations, Focus on nutritional counseling, etc."
                style={{width: '100%', height: '60px', padding: '8px', borderRadius: '4px', border: '1px solid #ddd'}}
              />
            </div>
            
            <button 
              onClick={() => {savePreferences(aiPreferences); setShowPreferences(false);}}
              className="btn" 
              style={{backgroundColor: '#27ae60', color: 'white', marginRight: '10px'}}
            >
              Save Preferences
            </button>
            <button 
              onClick={() => setShowPreferences(false)} 
              className="btn" 
              style={{backgroundColor: '#95a5a6', color: 'white'}}
            >
              Cancel
            </button>
          </div>
        )}

        {/* API Settings */}
        {showSettings && (
          <div style={{marginTop: '20px', padding: '20px', backgroundColor: '#fff5f5', borderRadius: '8px', border: '2px solid #e74c3c'}}>
            <h4>🔧 API Configuration</h4>
            <p style={{fontSize: '14px', color: '#666', marginBottom: '15px'}}>
              🔒 Your API keys are stored securely in your browser only. They never leave your device.
            </p>
            
            <div style={{marginBottom: '20px'}}>
              <h5>Azure Speech Service</h5>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 200px', gap: '10px', marginBottom: '10px'}}>
                <input
                  type={showApiKeys ? "text" : "password"}
                  placeholder="Azure Speech Service Key"
                  value={apiSettings.speechKey}
                  onChange={(e) => setApiSettings({...apiSettings, speechKey: e.target.value})}
                  style={{padding: '8px', borderRadius: '4px', border: '1px solid #ddd'}}
                />
                <select 
                  value={apiSettings.speechRegion}
                  onChange={(e) => setApiSettings({...apiSettings, speechRegion: e.target.value})}
                  style={{padding: '8px', borderRadius: '4px', border: '1px solid #ddd'}}
                >
                  <option value="eastus">East US</option>
                  <option value="westus2">West US 2</option>
                  <option value="centralus">Central US</option>
                  <option value="westeurope">West Europe</option>
                </select>
              </div>
            </div>
            
            <div style={{marginBottom: '20px'}}>
              <h5>Azure OpenAI Service</h5>
              <div style={{display: 'grid', gridTemplateColumns: '1fr', gap: '10px', marginBottom: '10px'}}>
                <input
                  type="text"
                  placeholder="https://your-openai-resource.openai.azure.com/"
                  value={apiSettings.openaiEndpoint}
                  onChange={(e) => setApiSettings({...apiSettings, openaiEndpoint: e.target.value})}
                  style={{padding: '8px', borderRadius: '4px', border: '1px solid #ddd'}}
                />
                <input
                  type={showApiKeys ? "text" : "password"}
                  placeholder="Azure OpenAI API Key"
                  value={apiSettings.openaiKey}
                  onChange={(e) => setApiSettings({...apiSettings, openaiKey: e.target.value})}
                  style={{padding: '8px', borderRadius: '4px', border: '1px solid #ddd'}}
                />
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px'}}>
                  <input
                    type="text"
                    placeholder="Deployment Name (e.g., gpt-4.1)"
                    value={apiSettings.openaiDeployment}
                    onChange={(e) => setApiSettings({...apiSettings, openaiDeployment: e.target.value})}
                    style={{padding: '8px', borderRadius: '4px', border: '1px solid #ddd'}}
                  />
                  <input
                    type="text"
                    placeholder="API Version"
                    value={apiSettings.openaiApiVersion}
                    onChange={(e) => setApiSettings({...apiSettings, openaiApiVersion: e.target.value})}
                    style={{padding: '8px', borderRadius: '4px', border: '1px solid #ddd'}}
                  />
                </div>
              </div>
            </div>
            
            <div style={{marginBottom: '15px'}}>
              <label>
                <input 
                  type="checkbox" 
                  checked={showApiKeys}
                  onChange={(e) => setShowApiKeys(e.target.checked)}
                  style={{marginRight: '8px'}}
                />
                👁️ Show API Keys
              </label>
            </div>
            
            <button 
              onClick={() => {
                saveApiSettings(apiSettings); 
                setShowSettings(false); 
                setStatus('✅ API settings saved successfully - Ready to record');
              }}
              className="btn" 
              style={{backgroundColor: '#27ae60', color: 'white', marginRight: '10px'}}
            >
              💾 Save API Settings
            </button>
            <button 
              onClick={() => setShowSettings(false)} 
              className="btn" 
              style={{backgroundColor: '#95a5a6', color: 'white'}}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Recording Controls */}
      <div className="control-panel">
        <h3>🎙️ Recording Session</h3>
        <div className="recording-controls">
          <button 
            className="btn btn-record" 
            onClick={startRecording} 
            disabled={isRecording}
          >
            {isRecording ? '🔴 Recording...' : '🎤 Start Recording'}
          </button>
          
          <button 
            className="btn btn-stop" 
            onClick={stopRecording} 
            disabled={!isRecording}
          >
            ⏹️ Stop Recording
          </button>
          
          <button 
            className="btn btn-generate" 
            onClick={generateMedicalNotes} 
            disabled={isProcessing || !transcript.trim()}
          >
            {isProcessing ? '⏳ Generating...' : '📝 Generate Notes'}
          </button>
          
          <button 
            className="btn" 
            onClick={saveVisitToPatient}
            disabled={!selectedPatient || !medicalNotes.trim()}
            style={{backgroundColor: '#e67e22', color: 'white'}}
          >
            💾 Save to Patient
          </button>
          
          <button 
            className="btn" 
            onClick={clearCurrentSession}
            style={{backgroundColor: '#95a5a6', color: 'white'}}
          >
            🗑️ Clear Session
          </button>
        </div>

        <div className={`status ${isRecording ? 'recording' : isProcessing ? 'processing' : ''}`}>
          {status}
        </div>
      </div>

      {/* Patient History */}
      {selectedPatient && selectedPatient.visits.length > 0 && (
        <div className="control-panel">
          <h3>📚 Recent Visits for {selectedPatient.name}</h3>
          <div style={{maxHeight: '200px', overflowY: 'auto'}}>
            {selectedPatient.visits.slice(-3).map(visit => (
              <div key={visit.id} style={{padding: '10px', marginBottom: '10px', backgroundColor: '#f8f9fa', borderRadius: '5px', borderLeft: '4px solid #3498db'}}>
                <strong>📅 {visit.timestamp}</strong>
                <p style={{margin: '5px 0', fontSize: '14px'}}>{visit.notes.substring(0, 150)}...</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transcript */}
      <div className="transcript-section">
        <h3>📋 Live Transcript</h3>
        <div className="transcript-text">
          {transcript || 'Transcript will appear here as you speak...'}
        </div>
      </div>

      {/* Generated Notes */}
      <div className="notes-section">
        <h3>📄 AI Generated Medical Notes</h3>
        <div className="notes-output">
          {medicalNotes || 'AI-generated medical notes will appear here...'}
        </div>
      </div>
    </div>
  );
}

export default App;
