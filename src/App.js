import React, { useState, useRef } from 'react';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import axios from 'axios';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [medicalNotes, setMedicalNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('Ready to record');
  
  const recognizerRef = useRef(null);
  const audioConfigRef = useRef(null);

  const startRecording = async () => {
    // Check if environment variables are loaded
    const speechKey = process.env.REACT_APP_AZURE_SPEECH_KEY;
    const speechRegion = process.env.REACT_APP_AZURE_SPEECH_REGION;
    
    if (!speechKey || !speechRegion) {
      setStatus('❌ Azure Speech keys not configured. Check environment variables.');
      console.error('Missing speech configuration:', { speechKey: !!speechKey, speechRegion: !!speechRegion });
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

    // Check OpenAI configuration
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
      const response = await axios.post(
        `${openaiEndpoint}openai/deployments/${deployment}/chat/completions?api-version=${process.env.REACT_APP_AZURE_OPENAI_API_VERSION}`,
        {
          messages: [
            {
              role: 'system',
              content: 'You are a medical scribe assistant specializing in obesity medicine. Convert the following conversation into structured medical notes including: Chief Complaint, History of Present Illness, Assessment, and Plan. Use medical terminology appropriately.'
            },
            {
              role: 'user',
              content: `Please convert this patient conversation into medical notes:\n\n${transcript}`
            }
          ],
          max_tokens: 1000,
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

  const clearAll = () => {
    setTranscript('');
    setMedicalNotes('');
    setStatus('Ready to record');
  };

  return (
    <div className="app">
      <div className="header">
        <h1>🏥 Medical Scribe AI</h1>
        <p>Obesity Medicine Assistant - Record consultations and generate structured notes</p>
      </div>

      <div className="control-panel">
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
            onClick={clearAll}
            style={{backgroundColor: '#95a5a6', color: 'white'}}
          >
            🗑️ Clear All
          </button>
        </div>

        <div className={`status ${isRecording ? 'recording' : isProcessing ? 'processing' : ''}`}>
          {status}
        </div>
      </div>

      <div className="transcript-section">
        <h3>📋 Live Transcript</h3>
        <div className="transcript-text">
          {transcript || 'Transcript will appear here as you speak...'}
        </div>
      </div>

      <div className="notes-section">
        <h3>📄 Generated Medical Notes</h3>
        <div className="notes-output">
          {medicalNotes || 'AI-generated medical notes will appear here...'}
        </div>
      </div>
    </div>
  );
}

export default App;
