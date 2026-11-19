import React, { useState, useEffect } from 'react';
import {
  CAP_LANGUAGES,
  ALERT_TEMPLATES,
  HAZARD_ZONES,
  TACTICAL_UNITS,
  RELIEF_SHELTERS,
  AUDIT_LOGS,
  ASSET_URLS,
} from '../data/mockData';
import { AuditLogEntry, TacticalUnit, ReliefShelter } from '../types';
import { sirenPlayer } from '../utils/audioSiren';
import { ApiError, LandslideApi } from '../services/api';
import {
  BellRing,
  Radio,
  Send,
  Languages,
  Users,
  ShieldAlert,
  Building2,
  Truck,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Clock,
  Compass,
  FileText,
  Volume2,
  VolumeX,
  Zap,
  X,
} from 'lucide-react';

interface BroadcastAndDispatchProps {
  onSirenTriggered?: () => void;
}

export const BroadcastAndDispatch: React.FC<BroadcastAndDispatchProps> = ({
  onSirenTriggered,
}) => {
  const selectedTarget = HAZARD_ZONES.find((zone) => zone.state === 'sikkim') || HAZARD_ZONES[0];
  const [selectedLang, setSelectedLang] = useState<string>('en');
  const [messageText, setMessageText] = useState<string>(ALERT_TEMPLATES['en']);
  const [recipientText, setRecipientText] = useState<string>('');
  const [targetId, setTargetId] = useState<string>(selectedTarget.id);
  const [isArmed, setIsArmed] = useState<boolean>(true);
  const [auditList, setAuditList] = useState<AuditLogEntry[]>(AUDIT_LOGS);
  const [tacticalUnits, setTacticalUnits] = useState<TacticalUnit[]>(TACTICAL_UNITS);
  const [reliefShelters, setReliefShelters] = useState<ReliefShelter[]>(RELIEF_SHELTERS);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSirenActive, setIsSirenActive] = useState<boolean>(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatchResult, setDispatchResult] = useState<{
    status: 'sent' | 'demo' | 'provider_not_configured' | 'provider_unavailable' | 'dispatch_failed';
    gateway: string;
    message: string;
    request_id?: string;
    recipients_count: number;
  } | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [smsStatus, setSmsStatus] = useState<{
    provider: string;
    demo_mode: boolean;
    configured: boolean;
    dlt_status: 'Configured' | 'Pending activation';
    sender_id: string | null;
    template_id: string | null;
  } | null>(null);

  const activeTarget = HAZARD_ZONES.find((zone) => zone.id === targetId) || selectedTarget;
  const recipientNumbers = recipientText.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
  const smsSegments = Math.max(1, Math.ceil(messageText.length / 160));

  useEffect(() => {
    return sirenPlayer.subscribe(setIsSirenActive);
  }, []);

  useEffect(() => {
    let active = true;
    LandslideApi.getAuditLogs().then((logs) => {
      if (active && logs && logs.length > 0) setAuditList(logs);
    });
    LandslideApi.getTacticalUnits().then((units) => {
      if (active && units && units.length > 0) setTacticalUnits(units);
    });
    LandslideApi.getReliefShelters().then((shelters) => {
      if (active && shelters && shelters.length > 0) setReliefShelters(shelters);
    });
    LandslideApi.getSmsStatus().then((status) => {
      if (active) setSmsStatus(status);
    }).catch(() => {
      if (active) setSmsStatus(null);
    });
    return () => {
      active = false;
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3800);
  };

  const handleLanguageChange = (langId: string) => {
    setSelectedLang(langId);
    setMessageText(ALERT_TEMPLATES[langId] || ALERT_TEMPLATES['en']);
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'sent':
        return 'SMS request accepted by provider.';
      case 'demo':
        return 'DEMO MODE — No real SMS was sent.';
      case 'provider_not_configured':
        return 'SMSHorizon is not configured or DLT activation is pending.';
      case 'provider_unavailable':
        return 'SMS provider is currently unavailable.';
      default:
        return 'SMS dispatch failed.';
    }
  };

  const handleExecuteDispatch = async () => {
    if (!messageText.trim()) {
      showToast('SMS message cannot be empty.');
      return;
    }

    setIsDispatching(true);
    setDispatchResult(null);
    setDispatchError(null);
    try {
      const smsRes = await LandslideApi.sendSmsBroadcast({
        headline: 'MANDATORY EVACUATION ALERT',
        instruction: messageText,
        phoneNumbers: recipientNumbers,
        state: activeTarget.state,
      });
      const normalizedResult = {
        ...smsRes,
        status: smsRes.status as 'sent' | 'demo' | 'provider_not_configured' | 'provider_unavailable' | 'dispatch_failed',
      };
      setDispatchResult(normalizedResult);
      showToast(statusLabel(smsRes.status));
      const refreshedLogs = await LandslideApi.getAuditLogs();
      if (refreshedLogs.length > 0) setAuditList(refreshedLogs);
      sirenPlayer.start();
      LandslideApi.triggerSiren(activeTarget.corridor, 6).catch(console.warn);
      if (onSirenTriggered) onSirenTriggered();
    } catch (err) {
      const httpStatus = err instanceof ApiError ? err.status : null;
      const errorMessage = httpStatus === 400
        ? 'Message validation failed. Review the SMS content.'
        : httpStatus === 401
        ? 'Operator authentication is required.'
        : httpStatus === 403
        ? 'Operator is not authorized to dispatch SMS.'
        : httpStatus === 408
        ? 'The SMS request timed out.'
        : httpStatus === 429
        ? 'Dispatch rate limit reached. Try again later.'
        : httpStatus && httpStatus >= 500
        ? 'SMS backend is currently unavailable.'
        : 'Unable to connect to the backend SMS service.';
      const failedResult = {
        status: httpStatus && httpStatus !== 408 ? 'dispatch_failed' as const : 'provider_unavailable' as const,
        gateway: 'SMSHorizon',
        message: errorMessage,
        recipients_count: 0,
      };
      setDispatchError(errorMessage);
      setDispatchResult(failedResult);
      showToast(errorMessage);
    } finally {
      setIsDispatching(false);
      setIsConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#2d1f17] text-[#ecd4a0] border border-[#e2c283] px-4 py-3 rounded-lg shadow-2xl shadow-cyan-950/80 flex items-center gap-3 font-sans text-xs sm:text-sm animate-bounce">
          <Zap className="w-4 h-4 text-[#e8863f] flex-shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {isConfirmOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="broadcast-confirm-title">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#231812] border border-[#e2c283]/50 rounded-xl p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#3a2a20] pb-3">
              <div>
                <h2 id="broadcast-confirm-title" className="text-base font-bold text-white">Confirm Emergency Broadcast</h2>
                <p className="text-xs text-[#a89283] mt-1">Review the operator dispatch before sending the request.</p>
              </div>
              <button onClick={() => setIsConfirmOpen(false)} className="text-[#a89283] hover:text-white" aria-label="Close confirmation">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-4 text-xs">
              <div><span className="text-[#a89283] block">Target state / area</span><span className="text-white font-semibold">{activeTarget.state.toUpperCase()} / {activeTarget.name}</span></div>
              <div><span className="text-[#a89283] block">Recipient count</span><span className="text-white font-semibold">{recipientNumbers.length} provided to backend</span></div>
              <div><span className="text-[#a89283] block">Sender ID</span><span className="text-white font-semibold">{smsStatus?.sender_id || 'Not configured'}</span></div>
              <div><span className="text-[#a89283] block">DLT template ID</span><span className="text-white font-semibold">{smsStatus?.template_id || 'Not configured'}</span></div>
              <div><span className="text-[#a89283] block">Estimated SMS segments</span><span className="text-white font-semibold">{smsSegments}</span></div>
              <div><span className="text-[#a89283] block">Dispatch mode</span><span className={`font-semibold ${smsStatus?.demo_mode ? 'text-[#e8863f]' : 'text-[#e2c283]'}`}>{smsStatus?.demo_mode ? 'DEMO' : 'PRODUCTION'}</span></div>
            </div>
            <div className="bg-[#1a110c] border border-[#4a372b] rounded-lg p-3 text-sm text-[#f3e9dc] whitespace-pre-wrap break-words">{messageText}</div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-4">
              <button onClick={() => setIsConfirmOpen(false)} className="px-4 py-2.5 rounded-lg border border-[#4a372b] text-xs font-bold text-[#cdb9a2] hover:text-white">CANCEL</button>
              <button onClick={handleExecuteDispatch} disabled={isDispatching} className="px-4 py-2.5 rounded-lg bg-[#9b2c2c] hover:bg-[#a8302a] disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> {isDispatching ? 'DISPATCHING...' : 'CONFIRM DISPATCH'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stage 3 Critical Escalation Banner */}
      <div className="bg-[#231812] border border-[#9b2c2c] rounded-xl p-4 sm:p-5 relative overflow-hidden shadow-2xl">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-[#9b2c2c] text-white text-[11px] font-mono font-bold px-2 py-0.5 rounded flex items-center gap-1.5 animate-pulse">
                <ShieldAlert className="w-3.5 h-3.5" />
                COMMON ALERTING PROTOCOL (CAP-CMSP)
              </span>
              <span className="text-[11px] font-mono text-[#e2c283] bg-[#3b2a14] px-2 py-0.5 rounded border border-[#cc5a14]/30">
                DISASTER MANAGEMENT ACT 2005 (SEC 30)
              </span>
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide">
              Emergency Broadcast &amp; Evacuation Corridor Management
            </h2>
            <p className="text-xs sm:text-sm text-[#cdb9a2] max-w-3xl">
              Authorized operators can prepare and review a multilingual emergency SMS request for the selected area. Provider acceptance and delivery are reported only when verified by SMSHorizon.
            </p>
          </div>

          {/* Broadcast Arm Control Button */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => setIsArmed(!isArmed)}
              className={`px-3 py-2 rounded-lg text-xs font-mono font-bold border transition-all cursor-pointer ${
                isArmed
                  ? 'bg-[#9b2c2c]/30 text-[#f09a8e] border-[#f09a8e]'
                  : 'bg-[#2d1f17] text-[#a89283] border-[#4a372b]'
              }`}
            >
              {isArmed ? 'TRANSMITTER: ARMED' : 'TRANSMITTER: STANDBY'}
            </button>

            <button
              onClick={() => setIsConfirmOpen(true)}
              disabled={!isArmed || !messageText.trim() || isDispatching}
              className={`px-4 py-2.5 rounded-lg text-xs sm:text-sm font-bold text-white flex items-center gap-2 shadow-lg transition-all cursor-pointer ${
                isArmed
                  ? 'bg-[#9b2c2c] hover:bg-[#a8302a] shadow-red-950/60 animate-pulse'
                  : 'bg-[#4a372b] opacity-50 cursor-not-allowed'
              }`}
            >
              <Send className="w-4 h-4" />
              <span>EXECUTE CAP BROADCAST</span>
            </button>

            {isSirenActive && (
              <button
                onClick={() => {
                  sirenPlayer.stop();
                  showToast('Emergency Acoustic Siren silenced.');
                }}
                className="px-3.5 py-2.5 rounded-lg text-xs sm:text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center gap-1.5 shadow-lg shadow-amber-950/60 animate-pulse transition-all cursor-pointer"
                title="Silence Active Acoustic Siren"
              >
                <VolumeX className="w-4 h-4" />
                <span>SILENCE SIREN</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Multi-Lingual Alert & Geofence Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Multilingual Alert Composer (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-[#231812] border border-[#3a2a20] rounded-xl p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#3a2a20] pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Languages className="w-4 h-4 text-[#e2c283]" />
                <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                  Multi-Lingual Alert Matrix (7 Regional Languages)
                </h3>
              </div>

            {smsStatus?.demo_mode && (
              <div className="mb-3 rounded-lg border border-[#e8863f]/60 bg-[#7a3a10]/20 px-3 py-2 text-xs font-bold text-[#e8863f]">DEMO MODE — No real SMS will be sent.</div>
            )}

            {dispatchResult && (
              <div className={`mb-3 rounded-lg border px-3 py-2.5 text-xs ${dispatchResult.status === 'sent' ? 'border-[#e2c283]/60 bg-[#3b2a14]/30 text-[#e2c283]' : dispatchResult.status === 'demo' ? 'border-[#e8863f]/60 bg-[#7a3a10]/20 text-[#e8863f]' : 'border-[#f09a8e]/60 bg-[#9b2c2c]/20 text-[#f09a8e]'}`}>
                <div className="font-bold">{statusLabel(dispatchResult.status)}</div>
                <div className="mt-1 text-current/80">Request ID: {dispatchResult.request_id || 'Unavailable'} · Recipients: {dispatchResult.recipients_count}</div>
              </div>
            )}
            {dispatchError && <div className="mb-3 text-xs text-[#f09a8e]">{dispatchError}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <label className="text-[10px] font-mono uppercase text-[#a89283]">Target area
                <select value={targetId} onChange={(event) => setTargetId(event.target.value)} className="mt-1 w-full bg-[#1a110c] text-white border border-[#4a372b] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#e2c283]">
                  {HAZARD_ZONES.map((zone) => <option key={zone.id} value={zone.id}>{zone.state.toUpperCase()} / {zone.name}</option>)}
                </select>
              </label>
              <div className="rounded-lg border border-[#3a2a20] bg-[#2d1f17] p-2.5 text-xs">
                <span className="text-[10px] font-mono uppercase text-[#a89283]">SMS Provider</span>
                <div className="text-white font-semibold mt-1">{smsStatus?.provider || 'SMSHorizon'}</div>
                <div className="text-[#cdb9a2] mt-0.5">DLT Status: <span className={smsStatus?.configured ? 'text-[#e2c283]' : 'text-[#e8863f]'}>{smsStatus?.dlt_status || 'Status unavailable'}</span></div>
              </div>
            </div>
              <span className="text-[10px] font-mono text-[#ecd4a0] bg-[#5e4325]/40 px-2 py-0.5 rounded border border-[#5e4325]">
                BHASHINI VERIFIED
              </span>
            </div>

            {/* Language Selection Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-2">
              {CAP_LANGUAGES.map((lang) => (
                <button
                  key={lang.id}
                  onClick={() => handleLanguageChange(lang.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border cursor-pointer ${
                    selectedLang === lang.id
                      ? 'bg-[#3a2a20] text-white border-[#e2c283]'
                      : 'bg-[#2d1f17] text-[#a89283] border-[#3a2a20] hover:text-white'
                  }`}
                >
                  <span>{lang.name}</span>
                </button>
              ))}
            </div>

            {/* Editable Text Area for SMS broadcast */}
            <div className="mt-3 relative">
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={4}
                className="w-full bg-[#1a110c] text-xs sm:text-sm text-[#f3e9dc] border border-[#4a372b] rounded-lg p-3 focus:outline-none focus:border-[#e2c283] font-sans resize-none leading-relaxed"
                placeholder="Compose or inspect emergency warning payload..."
              />
              <div className="flex items-center justify-between text-[11px] font-mono text-[#a89283] mt-1.5">
                <span>GSM Standard: 160 Chars/Segment</span>
                <span
                  className={
                    messageText.length > 160 ? 'text-[#e8863f]' : 'text-[#e2c283]'
                  }
                >
                  Length: {messageText.length} characters ({smsSegments} SMS)
                </span>
              </div>
            </div>

            {/* Quick Alert Presets */}
            <div className="mt-3 pt-3 border-t border-[#3a2a20]">
              <span className="text-[10px] font-mono text-[#a89283] block mb-2 uppercase">
                Quick Action Presets:
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    setMessageText(
                      'STAGE 3 EVACUATION ORDER: Mangan & Dikchu residents must vacate immediately via Route E-3 to Singtam Stadium. NH-10 closed. Dial 1077 for SDRF assistance.'
                    )
                  }
                  className="text-[11px] font-mono px-2 py-1 rounded bg-[#2d1f17] hover:bg-[#3a2a20] text-[#f09a8e] border border-[#9b2c2c] cursor-pointer"
                >
                  Mandatory Evacuation
                </button>
                <button
                  onClick={() =>
                    setMessageText(
                      'TRAFFIC WARNING: NH-10 Teesta Corridor completely shut due to mud debris at Km 38.4. All heavy goods vehicles divert via Kalimpong-Algarah. BRO clearing underway.'
                    )
                  }
                  className="text-[11px] font-mono px-2 py-1 rounded bg-[#2d1f17] hover:bg-[#3a2a20] text-[#e8863f] border border-[#7a3a10] cursor-pointer"
                >
                  Highway NH-10 Closure
                </button>
                <button
                  onClick={() =>
                    setMessageText(
                      'ALL CLEAR NOTICE: Slope stabilization completed at Km 38.4. Route E-3 open for two-way civilian movement. Continue monitoring LEWS app.'
                    )
                  }
                  className="text-[11px] font-mono px-2 py-1 rounded bg-[#2d1f17] hover:bg-[#3a2a20] text-[#ecd4a0] border border-[#5e4325] cursor-pointer"
                >
                  All Clear Advisory
                </button>
              </div>
            </div>
          </div>

          {/* Safe Evacuation Corridor Profile (Route E-3) */}
          <div className="bg-[#231812] border border-[#3a2a20] rounded-xl p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#3a2a20] pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-[#e2c283]" />
                <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                  Safe Evacuation Corridor: Route E-3 (Upper Singtam Ridge)
                </h3>
              </div>
              <span className="text-[10px] font-mono text-[#3b2a14] bg-[#e2c283] px-2 py-0.5 rounded font-bold">
                100% CLEAR
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              {/* Route Map preview image */}
              <div className="md:col-span-5 relative rounded-lg overflow-hidden border border-[#3a2a20] h-40">
                <img
                  src={ASSET_URLS.evacuationMapRoute}
                  alt="Route E-3 Evacuation Corridor Map"
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-2 left-2 bg-[#1a110c]/90 text-[10px] font-mono text-[#e2c283] px-1.5 py-0.5 rounded border border-[#4a372b]">
                  ROUTE E-3 ARTERY
                </div>
                <div className="absolute bottom-2 right-2 bg-[#3b2a14] text-[#e2c283] text-[9px] font-mono font-bold px-1.5 py-0.5 rounded">
                  ONE-WAY UPHILL FLOW
                </div>
              </div>

              {/* Elevation Profile SVG & Specs */}
              <div className="md:col-span-7 flex flex-col justify-between space-y-2">
                <div>
                  <div className="flex items-center justify-between text-xs text-[#a89283] font-mono">
                    <span>Elevation Profile (1,480m → 350m Singtam Valley)</span>
                    <span className="text-[#e2c283]">Total Dist: 18.4 km</span>
                  </div>

                  {/* Elevation Line Chart */}
                  <div className="h-20 w-full mt-1">
                    <svg className="w-full h-full" viewBox="0 0 300 80" preserveAspectRatio="none">
                      <path
                        d="M 10 20 Q 80 25 150 45 T 290 70"
                        fill="none"
                        stroke="#e2c283"
                        strokeWidth="2.5"
                      />
                      <path
                        d="M 10 20 Q 80 25 150 45 T 290 70 L 290 80 L 10 80 Z"
                        fill="#cc5a14"
                        opacity="0.1"
                      />
                      <circle cx="10" cy="20" r="4" fill="#f09a8e" />
                      <circle cx="290" cy="70" r="4" fill="#e2c283" />
                      <text x="15" y="24" fill="#f09a8e" fontSize="8" fontFamily="monospace">
                        Mangan (1,480m)
                      </text>
                      <text x="180" y="65" fill="#e2c283" fontSize="8" fontFamily="monospace">
                        Singtam Stadium (350m)
                      </text>
                    </svg>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="bg-[#2d1f17] p-2 rounded">
                    <span className="text-[10px] text-[#a89283] block">AVERAGE TRANSIT TIME</span>
                    <span className="text-white font-bold">32 mins (Civilian Bus)</span>
                  </div>
                  <div className="bg-[#2d1f17] p-2 rounded">
                    <span className="text-[10px] text-[#a89283] block">SDRF MARSHALS</span>
                    <span className="text-[#e2c283] font-bold">6 Checkposts Active</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Geofence Stats, Relief Shelters, Tactical Units (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Target and provider status */}
          <div className="bg-[#231812] border border-[#3a2a20] rounded-xl p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#3a2a20] pb-2.5 mb-3">
              <span className="font-mono text-xs font-bold uppercase text-white flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-[#e2c283]" />
                Broadcast Target
              </span>
              <span className="text-[10px] font-mono text-[#f09a8e] bg-[#9b2c2c]/40 px-2 py-0.5 rounded">
                OPERATOR CONTROLLED
              </span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="bg-[#2d1f17] p-2.5 rounded-lg border border-[#3a2a20]"><span className="text-[10px] text-[#a89283] block">STATE / AREA</span><span className="font-semibold text-white">{activeTarget.state.toUpperCase()} / {activeTarget.name}</span></div>
              <label className="block bg-[#2d1f17] p-2.5 rounded-lg border border-[#3a2a20] text-[10px] text-[#a89283]">RECIPIENTS PROVIDED
                <input value={recipientText} onChange={(event) => setRecipientText(event.target.value)} placeholder="Phone numbers, separated by commas" className="mt-1 w-full bg-[#1a110c] text-white border border-[#4a372b] rounded p-2 text-xs focus:outline-none focus:border-[#e2c283]" />
                <span className="block mt-1 text-[10px] text-[#cdb9a2]">{recipientNumbers.length} recipient(s) ready for review</span>
              </label>
            </div>
          </div>

          {/* Designated Relief Shelters */}
          <div className="bg-[#231812] border border-[#3a2a20] rounded-xl p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#3a2a20] pb-2.5 mb-3">
              <span className="font-mono text-xs font-bold uppercase text-white flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[#ecd4a0]" />
                Designated Safe Relief Shelters
              </span>
              <span className="text-[10px] font-mono text-[#a89283]">
                CAPACITY STATUS
              </span>
            </div>

            <div className="space-y-2.5">
              {reliefShelters.map((shelter) => (
                <div
                  key={shelter.id}
                  className="bg-[#2d1f17] border border-[#3a2a20] p-3 rounded-lg text-xs space-y-1.5"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-white">{shelter.name}</div>
                      <div className="text-[10px] text-[#a89283]">{shelter.location}</div>
                    </div>
                    <span
                      className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        shelter.status === 'CRITICAL'
                          ? 'bg-[#9b2c2c] text-[#ffd9d2]'
                          : 'bg-[#3b2a14] text-[#e2c283]'
                      }`}
                    >
                      {shelter.occupancyPercent}% FULL
                    </span>
                  </div>

                  {/* Capacity Bar */}
                  <div className="w-full h-1.5 bg-[#1a110c] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        shelter.occupancyPercent > 80 ? 'bg-[#f09a8e]' : 'bg-[#e2c283]'
                      }`}
                      style={{ width: `${shelter.occupancyPercent}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono text-[#cdb9a2] pt-1">
                    <span>
                      Occupancy: {shelter.capacityCurrent} / {shelter.capacityMax}
                    </span>
                    <span>Rations: {shelter.rationsDays}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tactical Units & Resource Stockpile */}
          <div className="bg-[#231812] border border-[#3a2a20] rounded-xl p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#3a2a20] pb-2.5 mb-3">
              <span className="font-mono text-xs font-bold uppercase text-white flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-[#e8863f]" />
                Tactical Units Mobilized
              </span>
              <span className="text-[10px] font-mono text-[#e8863f] bg-[#7a3a10]/40 px-2 py-0.5 rounded">
                {TACTICAL_UNITS.length} TEAMS ACTIVE
              </span>
            </div>

            <div className="space-y-2.5">
              {TACTICAL_UNITS.map((unit) => (
                <div
                  key={unit.id}
                  className="bg-[#2d1f17] border border-[#3a2a20] p-3 rounded-lg text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">{unit.name}</span>
                    <span className="text-[9px] font-mono font-bold bg-[#3b2a14] text-[#e2c283] px-1.5 py-0.5 rounded">
                      {unit.statusLabel}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#cdb9a2]">{unit.description}</p>
                  <div className="flex items-center justify-between text-[10px] font-mono text-[#a89283] pt-1 border-t border-[#3a2a20]">
                    <span>Personnel: {unit.personnel}</span>
                    <span className="text-[#ecd4a0]">{unit.satcomStatus}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Official SDMA Dispatch Audit Log */}
      <div className="bg-[#231812] border border-[#3a2a20] rounded-xl p-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-[#3a2a20] pb-3 mb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#e2c283]" />
            <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
              State Disaster Management Authority (SDMA) Dispatch Audit Stream
            </h3>
          </div>
          <span className="text-[10px] font-mono text-[#a89283]">
            CRYPTOGRAPHIC LEDGER • SEC 30 DMA 2005
          </span>
        </div>

        <div className="space-y-2.5">
          {auditList.map((log) => (
            <div
              key={log.id}
              className={`p-3 rounded-lg border text-xs transition-all ${
                log.highlight
                  ? 'bg-[#2d1f17] border-[#f09a8e]/50 shadow-md'
                  : 'bg-[#2d1f17]/60 border-[#3a2a20]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1 mb-1 font-mono text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#e2c283]">{log.code}</span>
                  <span className="text-white font-semibold">{log.title}</span>
                </div>
                <span className="text-[#a89283]">{log.timestamp}</span>
              </div>
              <p className="text-[#cdb9a2] text-xs leading-relaxed">{log.message}</p>
              <div className="mt-1.5 text-[10px] font-mono text-[#a89283]">
                Authority: {log.authority}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
