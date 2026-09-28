'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import CityMap from '@/components/city-map-client';
import { Camera, Upload, X, MapPin, FileText, CheckCircle2, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { ReportCategory, CATEGORY_LABELS, AKTAU_CENTER } from '@/lib/types';
import { CATEGORY_ICONS } from '@/lib/categories';
import { createReport, createReportWithPhoto, routeReport } from '@/lib/reports';
import { getSupporterToken } from '@/lib/supporter-token';
import { toast } from 'sonner';
import { DuplicateReportModal } from '@/components/duplicate-report-modal';

const CATEGORIES = Object.keys(CATEGORY_LABELS) as ReportCategory[];

export default function ReportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [category, setCategory] = useState<ReportCategory>('roads');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  
  // Duplicate detection state
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [bypassDuplicateCheck, setBypassDuplicateCheck] = useState(false);

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleMapClick(lat: number, lng: number) {
    setPosition([lat, lng]);
  }

  async function checkForDuplicates(): Promise<boolean> {
    if (!position) {
      console.log('[DUPLICATE_CHECK] No position, skipping');
      return false;
    }
    
    console.log('[DUPLICATE_CHECK_START] lat=', position[0], 'lng=', position[1], 'category=', category);
    setCheckingDuplicates(true);
    try {
      const response = await fetch(
        `/api/reports/check-duplicate?lat=${position[0]}&lng=${position[1]}&category=${category}`
      );
      
      if (!response.ok) {
        console.error('[DUPLICATE_CHECK_HTTP_ERROR] status=', response.status);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      console.log('[DUPLICATE_CHECK_RESPONSE] success=', data.success, 'duplicates=', data.duplicates?.length, 'data=', data);
      
      if (!data.success) {
        console.error('[DUPLICATE_CHECK_API_ERROR]', data.error);
        throw new Error(data.error || 'Failed to check for duplicates');
      }
      
      if (data.duplicates && data.duplicates.length > 0) {
        console.log('[DUPLICATE_CHECK_FOUND] showing modal with', data.duplicates.length, 'candidates');
        setDuplicates(data.duplicates);
        setShowDuplicateModal(true);
        return true; // Duplicates found
      }
      
      console.log('[DUPLICATE_CHECK_NONE] no duplicates found');
      return false; // No duplicates
    } catch (error) {
      console.error('[DUPLICATE_CHECK_ERROR]', error);
      toast.error('Не удалось проверить похожие обращения. Попробуйте ещё раз.');
      throw error; // Re-throw to stop submission
    } finally {
      setCheckingDuplicates(false);
    }
  }

  async function handleSupport(reportId: string) {
    const token = getSupporterToken();
    
    try {
      const response = await fetch(`/api/reports/${reportId}/support`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        if (data.alreadySupported) {
          toast.info('Вы уже поддержали эту проблему');
        } else {
          toast.success('Спасибо! Ваш голос добавлен к существующей проблеме.');
        }
        
        setShowDuplicateModal(false);
        // Navigate to the supported report
        router.push(`/dashboard/reports/${reportId}`);
      }
    } catch (error) {
      console.error('Error adding support:', error);
      toast.error('Не удалось добавить поддержку');
    }
  }

  function handleViewDetails(reportId: string) {
    setShowDuplicateModal(false);
    router.push(`/dashboard/reports/${reportId}`);
  }

  function handleCreateAnyway() {
    setShowDuplicateModal(false);
    setBypassDuplicateCheck(true);
    // Trigger the actual submission
    handleSubmit(new Event('submit') as any);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    // Prevent double submission
    if (submitting) {
      console.log('[SUBMIT_BLOCKED] already submitting');
      return;
    }
    
    setSubmitError(null);

    if (!description.trim() || !address.trim()) {
      toast.error('Заполните описание и адрес');
      return;
    }
    if (!position) {
      toast.error('Выберите местоположение на карте');
      return;
    }

    console.log('[SUBMIT_VALIDATION] bypassDuplicateCheck=', bypassDuplicateCheck);

    // Check for duplicates first (unless bypassed)
    if (!bypassDuplicateCheck) {
      console.log('[SUBMIT_CHECKING_DUPLICATES] about to call checkForDuplicates');
      try {
        const hasDuplicates = await checkForDuplicates();
        console.log('[SUBMIT_DUPLICATES_RESULT] hasDuplicates=', hasDuplicates);
        if (hasDuplicates) {
          console.log('[SUBMIT_STOPPED] duplicates found, showing modal');
          return; // Show duplicate modal, don't proceed
        }
      } catch (error) {
        console.log('[SUBMIT_STOPPED] duplicate check failed, error already shown to user');
        return; // Stop submission, error already shown to user
      }
    } else {
      console.log('[SUBMIT_BYPASS] duplicate check bypassed');
    }

    console.log('[SUBMIT_START] category=', category, 'hasPhoto=', !!photoFile);
    setSubmitting(true);

    const input = {
      category,
      description: description.trim(),
      address: address.trim(),
      lat: position[0],
      lng: position[1],
      photoUrl: null as string | null,
    };

    let report;
    try {
      report = photoFile
        ? await createReportWithPhoto(input, photoFile)
        : await createReport(input);
    } catch (err) {
      console.error('[SUBMIT_ERROR]', err);
      setSubmitting(false);
      const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
      setSubmitError(msg);
      toast.error('Не удалось отправить обращение');
      return;
    }

    setSubmitting(false);
    setSubmitted(true);
    toast.success('Обращение отправлено!');
    console.log('[SUBMIT_SUCCESS] reportId=', report.id);
    
    // Reset bypass flag for next submission
    setBypassDuplicateCheck(false);

    try {
      if (category === 'other') {
        await fetch(`/api/reports/${report.id}/category-discovery`, { method: 'POST' });
      } else {
        await routeReport(report.id);
      }
    } catch (error) {
      console.error('[POST_PROCESS_ROUTING_ERROR]', error);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto flex max-w-2xl flex-col items-center justify-center px-4 py-20 text-center sm:px-6">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-bold text-navy">
            Обращение отправлено!
          </h1>
          <p className="mt-3 max-w-md text-muted-foreground">
            Спасибо за ваше обращение. Оно появится на карте проблем и будет
            передано в соответствующую муниципальную службу.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => {
                setSubmitted(false);
                setPhotoFile(null);
                setPhotoPreview(null);
                setDescription('');
                setAddress('');
                setPosition(null);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-navy px-6 py-3 text-sm font-semibold text-white"
            >
              <FileText className="h-4 w-4" />
              Подать ещё одно
            </button>
            <button
              onClick={() => router.push('/map')}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-6 py-3 text-sm font-semibold text-navy hover:bg-muted"
            >
              <MapPin className="h-4 w-4" />
              Посмотреть на карте
            </button>
          </div>
        </div>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
        >
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-navy">
            Сообщить о проблеме
          </h1>
          <p className="mt-2 text-muted-foreground">
            Заполните форму ниже. Чем подробнее описание — тем быстрее служба
            найдёт и устранит проблему.
          </p>
        </div>

        {submitError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Photo upload */}
          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <label className="mb-3 block text-sm font-semibold text-navy">
              Фотография проблемы
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              className="hidden"
            />
            {photoPreview ? (
              <div className="relative">
                <img
                  src={photoPreview}
                  alt="Загруженное фото"
                  className="h-56 w-full rounded-lg object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPhotoFile(null);
                    setPhotoPreview(null);
                  }}
                  className="absolute right-2 top-2 rounded-lg bg-black/60 p-1.5 text-white backdrop-blur hover:bg-black/80"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-40 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/50 transition-colors hover:border-primary hover:bg-primary/5"
              >
                <Camera className="h-8 w-8 text-muted-foreground" />
                <span className="mt-2 text-sm font-medium text-muted-foreground">
                  Нажмите, чтобы загрузить фото
                </span>
                <span className="mt-0.5 text-xs text-muted-foreground/70">
                  JPG, PNG до 10 МБ
                </span>
              </button>
            )}
          </div>

          {/* Category */}
          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <label className="mb-3 block text-sm font-semibold text-navy">
              Категория проблемы
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CATEGORIES.map((cat) => {
                const Icon = CATEGORY_ICONS[cat];
                const active = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-all ${
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-white text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {CATEGORY_LABELS[cat]}
                  </button>
                );
              })}
            </div>
          </div>

          {category === 'other' && <p className="text-sm text-muted-foreground">После отправки фотография и описание будут переданы Gemini для уточнения категории. Если AI не уверен, обращение останется в категории «Другое».</p>}

          {/* Description */}
          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <label className="mb-2 block text-sm font-semibold text-navy">
              Описание
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Опишите проблему подробнее: что случилось, насколько давно, насколько серьёзно..."
              className="w-full resize-none rounded-lg border border-input bg-white px-3 py-2.5 text-sm placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Address */}
          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <label className="mb-2 block text-sm font-semibold text-navy">
              Адрес / расположение
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="мкр. 1, ул. Сатпаева, у дома 15"
                className="w-full rounded-lg border border-input bg-white py-2.5 pl-9 pr-3 text-sm placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Map location selector */}
          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <label className="mb-2 block text-sm font-semibold text-navy">
              Выберите местоположение на карте
            </label>
            <p className="mb-3 text-xs text-muted-foreground">
              Нажмите на карту, чтобы указать точное местоположение проблемы.
              Вы можете изменить выбор, нажав снова.
            </p>
            <div className="h-72 w-full overflow-hidden rounded-lg">
              <CityMap
                reports={[]}
                height="100%"
                zoom={14}
                interactive={true}
                selectionMode={true}
                selectedPosition={position}
                onMapClick={handleMapClick}
                showPopups={false}
              />
            </div>
            {position ? (
              <p className="mt-2 text-xs text-emerald-600 font-medium">
                Местоположение выбрано: {position[0].toFixed(5)}, {position[1].toFixed(5)}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Местоположение не выбрано
              </p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy px-6 py-4 text-base font-semibold text-white shadow-lg transition-all hover:bg-navy-light disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Отправка...
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                Отправить обращение
              </>
            )}
          </button>
        </form>
      </div>
      <SiteFooter />
      
      {/* Duplicate Report Modal */}
      <DuplicateReportModal
        isOpen={showDuplicateModal}
        duplicates={duplicates}
        onSupport={handleSupport}
        onCreateAnyway={handleCreateAnyway}
        onCancel={() => setShowDuplicateModal(false)}
        onViewDetails={handleViewDetails}
      />
    </div>
  );
}
