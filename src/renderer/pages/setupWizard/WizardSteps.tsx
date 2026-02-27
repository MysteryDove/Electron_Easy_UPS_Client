import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { SetupMode, WizardStep } from './types';

type WizardStepsProps = {
  currentStep: Exclude<WizardStep, 'choose'>;
  mode: SetupMode;
};

export function WizardSteps({ currentStep, mode }: WizardStepsProps) {
  const { t } = useTranslation();
  const steps =
    mode === 'directNut'
      ? [
        { id: 'connect', label: t('wizard.stepConnect', 'Connect') },
        { id: 'map', label: t('wizard.stepMap', 'Map') },
        { id: 'line', label: t('wizard.stepLine', 'Line') },
      ]
      : [
        { id: 'nutSetup', label: t('wizard.stepSetup', 'NUT Setup') },
        { id: 'connect', label: t('wizard.stepConnect', 'Connect') },
        { id: 'map', label: t('wizard.stepMap', 'Map') },
        { id: 'line', label: t('wizard.stepLine', 'Line') },
      ];

  const currentIndex = steps.findIndex((step) => step.id === currentStep);

  return (
    <div className="wizard-steps">
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isActive = index === currentIndex;
        const className = isCompleted
          ? 'wizard-step wizard-step--completed'
          : isActive
            ? 'wizard-step wizard-step--active'
            : 'wizard-step';

        return (
          <div
            key={step.id}
            style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}
          >
            <div className={className}>
              <div className="wizard-step-circle">
                {isCompleted ? <Check size={14} /> : String(index + 1)}
              </div>
              <span>{step.label}</span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`wizard-step-separator ${isCompleted ? 'wizard-step-separator--active' : ''}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
