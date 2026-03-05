'use client';

import React from 'react';

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export const FormInput: React.FC<FormInputProps> = ({
  label,
  error,
  helperText,
  id,
  className = '',
  ...props
}) => {
  const inputId = id || label.toLowerCase().replace(/\s+/g, '-');
  
  return (
    <div className="mb-4">
      {/* Label */}
      <label 
        htmlFor={inputId}
        className="block font-medium text-sm text-gray-700 mb-1.5"
      >
        {label}
      </label>
      
      {/* Input */}
      <input
        id={inputId}
        className={`
          w-full
          border rounded-lg
          px-3.5 py-2.5
          text-base
          bg-white
          transition-all
          duration-200
          focus:outline-none
          focus:ring-3
          disabled:bg-gray-100
          disabled:cursor-not-allowed
          ${error 
            ? 'border-red-500 focus:border-red-500 focus:ring-red-100' 
            : 'border-gray-300 focus:border-[#003B7A] focus:ring-blue-100'
          }
          ${className}
        `.trim()}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
        {...props}
      />
      
      {/* Error Message */}
      {error && (
        <p 
          id={`${inputId}-error`}
          className="mt-1.5 text-sm text-red-600"
          role="alert"
        >
          {error}
        </p>
      )}
      
      {/* Helper Text */}
      {!error && helperText && (
        <p 
          id={`${inputId}-helper`}
          className="mt-1.5 text-sm text-gray-500"
        >
          {helperText}
        </p>
      )}
    </div>
  );
};
