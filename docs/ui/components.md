# UI Components Documentation

This document describes the key UI components and patterns used in the Cell Segmentation Hub frontend application.

## Design System

The application uses a modern glass-morphism design system with the following key characteristics:

- **Glass-morphism effects**: Semi-transparent backgrounds with blur effects
- **Consistent spacing**: Tailwind CSS spacing scale
- **Color palette**: Blue primary colors with neutral grays
- **Typography**: Modern sans-serif with proper hierarchy
- **Responsive design**: Mobile-first approach with breakpoint considerations

## Core Components

### Logo Component (`src/components/header/Logo.tsx`)

The main application logo component used in headers and navigation.

```tsx
import React from 'react';
import { Link } from 'react-router-dom';

const Logo = () => {
  return (
    <Link to="/dashboard" className="flex items-center">
      <img src="/logo.svg" alt="SpheroSeg Logo" className="w-9 h-9" />
      <span className="ml-2 text-xl font-semibold hidden sm:inline-block dark:text-white">
        SpheroSeg
      </span>
    </Link>
  );
};
```

**Features**:

- SVG logo with responsive sizing
- Text label hidden on small screens
- Dark mode support
- Links to dashboard when authenticated

**Usage**:

- Main navigation (`Navbar.tsx`)
- Dashboard header (`Logo.tsx`)
- Authentication pages (SignIn/SignUp)

### DeleteAccountDialog Component (`src/components/settings/DeleteAccountDialog.tsx`)

GitHub-style account deletion confirmation dialog with security measures.

**Key Features**:

- **Email confirmation**: User must type their exact email address
- **Glass-morphism styling**: Consistent with app design
- **Real-time validation**: Delete button only enables when email matches
- **Security-focused**: Prevents accidental deletions

**Implementation Pattern**:

```tsx
const [confirmationText, setConfirmationText] = useState('');
const isConfirmationValid = confirmationText === userEmail;

// Delete button only enabled when confirmation is valid
<Button disabled={!isConfirmationValid} variant="destructive">
  Delete Account
</Button>;
```

**Security Considerations**:

- Requires exact email match (case-sensitive)
- Immediate and irreversible deletion
- Rate limited on backend (3 attempts per hour)
- Clear warning messages about data loss

### Glass-morphism Components

The application extensively uses glass-morphism effects for modern UI aesthetics.

**Base Glass Classes**:

```css
.glass-morphism {
  @apply bg-white/80 backdrop-blur-md border border-white/20;
}

.shadow-glass-lg {
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}
```

**Common Usage**:

- Authentication forms (SignIn/SignUp)
- Modal dialogs
- Card components
- Navigation elements

### Authentication Forms

#### SignIn Component (`src/pages/SignIn.tsx`)

**Features**:

- Glass-morphism card design
- Floating background animations
- Absolute positioned back button (top-left)
- Auto-redirect for authenticated users
- Error handling with toast notifications

**Key Implementation**:

```tsx
{
  /* Back button - positioned at top left of screen */
}
<div className="absolute top-6 left-6 z-10">
  <Link
    to="/"
    className="inline-flex items-center justify-center w-10 h-10 glass-morphism rounded-full hover:bg-white/20 transition-all duration-200"
  >
    <ArrowLeft className="w-5 h-5 text-gray-700" />
  </Link>
</div>;

{
  /* Floating background animations */
}
<div className="absolute inset-0 -z-10">
  <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-blue-200/30 rounded-full filter blur-3xl animate-float" />
  <div
    className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-blue-300/20 rounded-full filter blur-3xl animate-float"
    style={{ animationDelay: '-2s' }}
  />
</div>;
```

#### SignUp Component (`src/pages/SignUp.tsx`)

Similar design to SignIn with additional fields:

- Email validation
- Password confirmation
- Terms acceptance checkbox
- Duplicate prevention for logged-in users

### Navigation Components

#### Navbar Component (`src/components/Navbar.tsx`)

Main navigation for public pages (before authentication).

**Features**:

- Responsive design with mobile menu
- Scroll-based background changes
- Logo integration
- Glass-morphism effects on scroll

**Responsive Behavior**:

```tsx
const [isScrolled, setIsScrolled] = useState(false);

// Dynamic styling based on scroll
className={`fixed top-0 left-0 right-0 w-full z-50 transition-all duration-300 ${
  isScrolled
    ? "py-3 bg-white/80 backdrop-blur-md shadow-sm"
    : "py-5 bg-transparent"
}`}
```

#### Logo Header (`src/components/header/Logo.tsx`)

Used in authenticated dashboard areas.

## Animation Patterns

### CSS Animations

**Float Animation** (for background elements):

```css
@keyframes float {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  33% {
    transform: translateY(-10px) rotate(1deg);
  }
  66% {
    transform: translateY(5px) rotate(-1deg);
  }
}

.animate-float {
  animation: float 6s ease-in-out infinite;
}
```

**Scale Animation** (for modal entries):

```css
@keyframes scale-in {
  0% {
    transform: scale(0.9);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.animate-scale-in {
  animation: scale-in 0.2s ease-out;
}
```

### Transition Patterns

**Standard Transitions**:

- `transition-all duration-200` - For button hovers
- `transition-colors` - For color-only changes
- `transition-opacity` - For fade effects

## Form Patterns

### Auto-save Implementation

Used in Settings/Models section:

```tsx
const handleThresholdChange = (value: number[]) => {
  setConfidenceThreshold(value[0] / 100);
  toast.success(t('settings.modelSettingsSaved'));
};
```

**Benefits**:

- Immediate feedback
- No "Save" button required
- Reduced cognitive load

### Validation Patterns

**Real-time Validation**:

```tsx
const [confirmationText, setConfirmationText] = useState('');
const isValid = confirmationText === requiredValue;

// Visual feedback
<Input
  className={isValid ? 'border-green-500' : 'border-gray-300'}
  value={confirmationText}
  onChange={e => setConfirmationText(e.target.value)}
/>;
```

## Toast Notifications

The application uses Sonner for toast notifications with specific positioning:

```tsx
import { Toaster as Sonner } from '@/components/ui/sonner';

<Sonner
  position="bottom-right"
  closeButton
  toastOptions={{
    className: 'animate-slide-in-right',
  }}
/>;
```

**Best Practices**:

- Only bottom-right positioning (duplicate toasters removed)
- Success messages for auto-save operations
- Error messages for failed validations
- Close button enabled for user control

## Responsive Design

### Breakpoint Strategy

- **Mobile First**: Base styles for mobile
- **sm: (640px+)**: Small tablets and large phones
- **md: (768px+)**: Tablets and small laptops
- **lg: (1024px+)**: Laptops and desktops

### Common Responsive Patterns

```tsx
// Conditional rendering based on screen size
<span className="hidden sm:inline-block">Desktop Text</span>

// Responsive grid layouts
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

// Mobile menu patterns
<button className="md:hidden">
  {isMobileMenuOpen ? <X /> : <Menu />}
</button>
```

## Accessibility

### Best Practices Implemented

- **ARIA labels**: All interactive elements have appropriate labels
- **Keyboard navigation**: Focus management and tab order
- **Color contrast**: Meets WCAG AA standards
- **Screen reader support**: Semantic HTML structure

### Example Implementation

```tsx
<button
  className="md:hidden text-gray-700"
  onClick={toggleMobileMenu}
  aria-label="Toggle menu"
  aria-expanded={isMobileMenuOpen}
>
  {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
</button>
```

## Theme System

### Dark Mode Support

Components prepared for dark mode with conditional classes:

```tsx
<span className="dark:text-white">Text that adapts to theme</span>
```

### Color Variables

The application uses CSS custom properties for consistent theming:

```css
:root {
  --primary-blue: #3e74b6;
  --glass-bg: rgba(255, 255, 255, 0.8);
  --glass-border: rgba(255, 255, 255, 0.2);
}
```

## Performance Considerations

### Image Optimization

- **SVG logos**: Vector graphics for crisp display at any size
- **Lazy loading**: Images load only when needed
- **Static assets**: Served from `/public` for optimal caching

### Bundle Optimization

- **Component splitting**: Large components split into smaller files
- **Import optimization**: Only import needed utilities from libraries
- **CSS purging**: Unused styles removed in production

## Component Architecture

### File Organization

```
src/
├── components/
│   ├── ui/              # Base UI components (buttons, inputs)
│   ├── header/          # Header-specific components
│   ├── settings/        # Settings page components
│   └── project/         # Project-related components
├── pages/               # Page components
└── contexts/            # React contexts for state
```

### Naming Conventions

- **PascalCase**: Component names and filenames
- **camelCase**: Function and variable names
- **kebab-case**: CSS classes (following Tailwind)
- **SCREAMING_SNAKE_CASE**: Constants

This documentation provides a comprehensive overview of the UI components and patterns used in the Cell Segmentation Hub application, focusing on the modern glass-morphism design system and responsive, accessible implementation patterns.
