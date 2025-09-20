import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Clock, User, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/useLanguage';

export interface ProcessingSlot {
  id: number;
  isActive: boolean;
  userId?: string;
  userName?: string;
  imageId?: string;
  estimatedCompletion?: number; // seconds remaining
  progress?: number; // 0-100
}

export interface ProcessingSlotsProps {
  totalSlots: number;
  activeSlots: ProcessingSlot[];
  currentUserId?: string;
  className?: string;
}

export const ProcessingSlots: React.FC<ProcessingSlotsProps> = ({
  totalSlots = 4,
  activeSlots = [],
  currentUserId,
  className,
}) => {
  const { t } = useLanguage();

  // Create array of all slots with their status
  const allSlots = Array.from({ length: totalSlots }, (_, index) => {
    const activeSlot = activeSlots.find(slot => slot.id === index);
    return activeSlot || { id: index, isActive: false };
  });

  const getCurrentUserSlot = () => {
    return activeSlots.find(slot => slot.userId === currentUserId);
  };

  const getOtherActiveUsers = () => {
    return activeSlots
      .filter(slot => slot.userId && slot.userId !== currentUserId)
      .map(slot => slot.userName || `User ${slot.userId?.slice(-4)}`)
      .slice(0, 2); // Show max 2 other users
  };

  const renderSlot = (slot: ProcessingSlot) => {
    const isCurrentUser = slot.userId === currentUserId;

    return (
      <motion.div
        key={slot.id}
        className={cn(
          'relative flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-all duration-300',
          slot.isActive
            ? isCurrentUser
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
              : 'border-green-500 bg-green-50 dark:bg-green-950/20'
            : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800',
          'min-h-[60px] min-w-[80px]'
        )}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2, delay: slot.id * 0.1 }}
      >
        {/* Slot indicator */}
        <div className="flex items-center gap-2 mb-1">
          {slot.isActive ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <Activity
                className={cn(
                  'h-4 w-4',
                  isCurrentUser ? 'text-blue-600' : 'text-green-600'
                )}
              />
            </motion.div>
          ) : (
            <Clock className="h-4 w-4 text-gray-400" />
          )}
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
            #{slot.id + 1}
          </span>
        </div>

        {/* User indicator */}
        {slot.isActive && (
          <div className="flex items-center gap-1 text-xs">
            <User className="h-3 w-3" />
            <span
              className={cn(
                'font-medium truncate max-w-[60px]',
                isCurrentUser
                  ? 'text-blue-700 dark:text-blue-300'
                  : 'text-green-700 dark:text-green-300'
              )}
            >
              {isCurrentUser ? t('queue.you') : slot.userName || 'User'}
            </span>
          </div>
        )}

        {/* Progress indicator */}
        {slot.isActive && slot.progress !== undefined && (
          <div className="w-full mt-1">
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
              <motion.div
                className={cn(
                  'h-1 rounded-full',
                  isCurrentUser ? 'bg-blue-500' : 'bg-green-500'
                )}
                initial={{ width: 0 }}
                animate={{ width: `${slot.progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
        )}

        {/* Estimated completion */}
        {slot.isActive && slot.estimatedCompletion && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ~{Math.ceil(slot.estimatedCompletion / 60)}m
          </div>
        )}
      </motion.div>
    );
  };

  const currentUserSlot = getCurrentUserSlot();
  const otherUsers = getOtherActiveUsers();
  const availableSlots = totalSlots - activeSlots.length;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('queue.processingSlots')}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          <span className="bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded">
            {activeSlots.length}/{totalSlots} {t('queue.active')}
          </span>
        </div>
      </div>

      {/* Processing slots grid */}
      <div className="grid grid-cols-4 gap-2">{allSlots.map(renderSlot)}</div>

      {/* Status summary */}
      <div className="flex flex-col gap-1 text-xs">
        {/* Current user status */}
        {currentUserSlot && (
          <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span>{t('queue.yourSlot', { slot: currentUserSlot.id + 1 })}</span>
          </div>
        )}

        {/* Other concurrent users */}
        {otherUsers.length > 0 && (
          <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span>
              {t('queue.concurrentUsers', {
                users: otherUsers.join(', '),
                count: otherUsers.length,
              })}
            </span>
          </div>
        )}

        {/* Available slots */}
        {availableSlots > 0 && (
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
            <div className="w-2 h-2 bg-gray-400 rounded-full" />
            <span>{t('queue.availableSlots', { count: availableSlots })}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProcessingSlots;
