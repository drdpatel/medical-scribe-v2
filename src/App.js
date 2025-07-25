import React, { useState, useRef, useEffect } from 'react';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import axios from 'axios';

function App() {
  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [medicalNotes, setMedicalNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('Ready to record');
  
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
  
  const recognizerRef = useRef(null);
  const audioConfigRef = useRef(null);

  // Load data from localStorage on app start
  useEffect(() => {
    const savedPatients = localStorage.getItem('medicalScribePatients');
    const savedPreferences = localStorage.getItem('medicalScribePreferences');
    
    if (savedPatients) {
      setPatients(JSON.parse(savedPatients));
    }
    
    if (savedPreferences) {
      setAiPreferences(JSON.parse(savedPreferences));
    }
  }, []);

  // Save patients to localStorage
  const savePatients = (updatedPatients) => {
    setPatients(updatedPatients);
    localStorage.setItem('medicalScribePatients', JSON.stringify(updatedPatients));
  };

  // Save AI preferences
  const savePreferences = (prefs) => {
    setAiPreferences(prefs);
    localStorage.setItem('medicalScribePreferences', JSON.stringify(prefs));
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
    const speechKey = process.env.REACT_APP_AZURE_SPEECH_KEY;
    const speechRegion = process.env.REACT_APP_AZURE_SPEECH_REGION;
    
    if (!speechKey || !speechRegion) {
      setStatus('❌ Azure Speech keys not configured. Check environment variables.');
      return;
    }

    try {
      setStatus('🔧 Requesting microphone access...');
      
      const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(speechKey, speechRegion);
      speechConfig.speechRecognitionLanguage = 'en-US';
      
      audioConfigRef.current = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfigRef.current);

      recognizerRef.current.recognizing = (s, e) => {
        setTranscript(prev => prev + ' ' + e.result.text);
      };

      recognizerRef.current.recognized = (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
          setTranscript(prev => prev + ' ' + e.result.text);
        }
      };

      recognizerRef.current.startContinuousRecognitionAsync(
        () => {
          setIsRecording(true);
          setStatus('🔴 Recording... Speak now');
        },
        (error) => {
          console.error('Recognition start error:', error);
          setStatus('❌ Microphone access denied or unavailable');
        }
      );
      
    } catch (error) {
      console.error('Recording setup error:', error);
      setStatus('❌ Recording failed: ' + error.message);
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

    const openaiEndpoint = process.env.REACT_APP_AZURE_OPENAI_ENDPOINT;
    const openaiKey = process.env.REACT_APP_AZURE_OPENAI_KEY;
    const deployment = process.env.REACT_APP_AZURE_OPENAI_DEPLOYMENT;

    if (!openaiEndpoint || !openaiKey || !deployment) {
      setStatus('❌ Azure OpenAI not configured. Check environment variables.');
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
        `${openaiEndpoint}openai/deployments/${deployment}/chat/completions?api-version=${process.env.REACT_APP_AZURE_OPENAI_API_VERSION}`,
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
      setStatus('❌ Failed to generate notes. Check Azure OpenAI configuration.');
      setMedicalNotes('Error generating notes: ' + (error.response?.data?.error?.message || error.message));
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
