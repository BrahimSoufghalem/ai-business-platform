import type { SVGProps } from 'react';

export type IconName =
  | 'alert-circle'
  | 'alert-triangle'
  | 'arrow-back'
  | 'bell'
  | 'bot'
  | 'box'
  | 'check'
  | 'check-circle'
  | 'chevron-down'
  | 'chevron-forward'
  | 'clipboard'
  | 'close'
  | 'eye'
  | 'eye-off'
  | 'filter'
  | 'globe'
  | 'image'
  | 'inbox'
  | 'info'
  | 'instagram'
  | 'logout'
  | 'menu'
  | 'more'
  | 'overview'
  | 'package'
  | 'pencil'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'send'
  | 'settings'
  | 'shopping-bag'
  | 'store'
  | 'trash'
  | 'upload'
  | 'users';

const paths: Record<IconName, string> = {
  'alert-circle': 'M12 8v5m0 3.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  'alert-triangle':
    'M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0ZM12 9v4m0 3.5v.5',
  'arrow-back': 'M19 12H5m0 0 6 6m-6-6 6-6',
  bell: 'M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 0 1-6 0v-1m6 0H9',
  bot: 'M8 15h.01M16 15h.01M9 11V9m6 2V9M7 4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1V4Zm1 3h8V5H8v2Zm4 12v2',
  box: 'M21 8.5v7a2 2 0 0 1-1 1.73l-6 3.5a2 2 0 0 1-2 0l-6-3.5A2 2 0 0 1 5 15.5v-7a2 2 0 0 1 1-1.73l6-3.5a2 2 0 0 1 2 0l6 3.5a2 2 0 0 1 1 1.73ZM5.3 7.7 12 11.6l6.7-3.9M12 22V11.6',
  check: 'm4.5 12.5 5 5 10-11',
  'check-circle': 'm8.5 12.5 2.5 2.5 5-5.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-forward': 'm9 6 6 6-6 6',
  clipboard:
    'M9 4h6m-6 0a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2M9 4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2',
  close: 'M6 6l12 12M18 6 6 18',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'eye-off':
    'M4 4l16 16M10.6 5.2A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.9 3.9M6.6 6.6A16.4 16.4 0 0 0 2 12s3.5 7 10 7c1.5 0 2.8-.3 4-.8M9.9 9.9a3 3 0 0 0 4.2 4.2',
  filter: 'M4 5h16l-6 8v5l-4 2v-7L4 5Z',
  globe:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3a13.7 13.7 0 0 1 3.6 9 13.7 13.7 0 0 1-3.6 9 13.7 13.7 0 0 1-3.6-9A13.7 13.7 0 0 1 12 3Z',
  image:
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 14 4.5-4.5a1.5 1.5 0 0 1 2 0L17 18m-2-2 1.5-1.5a1.5 1.5 0 0 1 2 0L21 17M9 9.5A1.5 1.5 0 1 0 9 6.5a1.5 1.5 0 0 0 0 3Z',
  inbox:
    'M22 12h-6l-2 3h-4l-2-3H2m20 0v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6m20 0-3.5-7.1A2 2 0 0 0 16.7 3.6H7.3a2 2 0 0 0-1.8 1.3L2 12',
  info: 'M12 16v-5m0-3.5V7M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  instagram:
    'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm5 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm5.3-8.3v.4',
  logout: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5m5 5H3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  overview: 'M4 4h6v7H4V4Zm10 0h6v4h-6V4ZM4 15h6v5H4v-5Zm10-3h6v8h-6v-8Z',
  package: 'M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 0v9m9-4.5L12 11 3 6.5m9 15V11',
  pencil: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.3-4.3',
  send: 'm22 2-7 20-4-9-9-4 20-7Zm0 0L11 13',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5L9 5.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2L9.5 21h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  'shopping-bag': 'M6 7h12l1 14H5L6 7Zm3 0V5a3 3 0 0 1 6 0v2',
  store: 'M3 9 4.5 3h15L21 9M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9M3 9h18M9 21v-6h6v6',
  trash:
    'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6m4-6v6',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m14-7-5-5-5 5m5-5v12',
  users:
    'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M15 3.1a4 4 0 0 1 0 7.8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
};

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
