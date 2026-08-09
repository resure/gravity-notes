interface IconProps {
    size?: number;
}

const svgProps = (size: number) => ({
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
});

export const PlusIcon = ({size = 16}: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M7.25 2.75a.75.75 0 0 1 1.5 0v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5Z" />
    </svg>
);

export const DragIcon = ({size = 14}: IconProps) => (
    <svg width={size} height={size + 4} viewBox="0 0 10 14" fill="currentColor" stroke="none">
        <circle cx="3" cy="2.2" r="1.3" />
        <circle cx="7" cy="2.2" r="1.3" />
        <circle cx="3" cy="7" r="1.3" />
        <circle cx="7" cy="7" r="1.3" />
        <circle cx="3" cy="11.8" r="1.3" />
        <circle cx="7" cy="11.8" r="1.3" />
    </svg>
);

export const CheckIcon = ({size = 12}: IconProps) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 14 14"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
    </svg>
);

export const TextIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <path d="M4 5h12" />
        <path d="M10 5v10.5" />
        <path d="M7.5 15.5h5" />
    </svg>
);

const HeadingIcon = ({size = 18, level}: IconProps & {level: string}) => (
    <svg {...svgProps(size)}>
        <path d="M3.5 4.5v11M10.5 4.5v11M3.5 10h7" />
        <text
            x="13"
            y="15.5"
            fontSize="8.5"
            fontWeight="600"
            fill="currentColor"
            stroke="none"
            fontFamily="inherit"
        >
            {level}
        </text>
    </svg>
);

export const H1Icon = (p: IconProps) => <HeadingIcon {...p} level="1" />;
export const H2Icon = (p: IconProps) => <HeadingIcon {...p} level="2" />;
export const H3Icon = (p: IconProps) => <HeadingIcon {...p} level="3" />;

export const TodoIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <rect x="3" y="3" width="14" height="14" rx="3" />
        <path d="M6.8 10.2 9 12.4l4.2-4.8" />
    </svg>
);

export const BulletedIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <circle cx="4" cy="5" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="4" cy="10" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="4" cy="15" r="1.4" fill="currentColor" stroke="none" />
        <path d="M8 5h8.5M8 10h8.5M8 15h8.5" />
    </svg>
);

export const NumberedIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <text x="2" y="7" fontSize="6" fill="currentColor" stroke="none" fontFamily="inherit">
            1
        </text>
        <text x="2" y="12.5" fontSize="6" fill="currentColor" stroke="none" fontFamily="inherit">
            2
        </text>
        <text x="2" y="18" fontSize="6" fill="currentColor" stroke="none" fontFamily="inherit">
            3
        </text>
        <path d="M8 5h8.5M8 10h8.5M8 15h8.5" />
    </svg>
);

export const ToggleIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <path d="m6.5 4.5 6 5.5-6 5.5Z" fill="currentColor" stroke="none" />
    </svg>
);

export const TableIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <rect x="2.5" y="3" width="15" height="14" rx="1.5" />
        <path d="M2.5 8h15M7.5 3v14M12.5 3v14" />
    </svg>
);

export const QuoteIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <path d="M4 3.5v13" strokeWidth="2" />
        <path d="M8.5 6h8M8.5 10h8M8.5 14h5" />
    </svg>
);

export const DividerIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <path d="M5.5 5h9" opacity="0.45" />
        <path d="M2.5 10h15" strokeWidth="1.7" />
        <path d="M5.5 15h9" opacity="0.45" />
    </svg>
);

export const CalloutIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <rect x="2.5" y="4" width="15" height="12" rx="2.5" />
        <circle cx="6.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
        <path d="M9.5 10h4.5" />
    </svg>
);

export const CodeIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <path d="m7 6-4 4 4 4" />
        <path d="m13 6 4 4-4 4" />
    </svg>
);

export const TrashIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <path d="M3.5 5.5h13" />
        <path d="M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
        <path d="M5 5.5 5.8 16a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9l.8-10.5" />
        <path d="M8.2 8.5v5M11.8 8.5v5" />
    </svg>
);

export const DuplicateIcon = ({size = 18}: IconProps) => (
    <svg {...svgProps(size)}>
        <rect x="6.5" y="6.5" width="10" height="10" rx="2" />
        <path d="M13.5 4.5v-.3a1.7 1.7 0 0 0-1.7-1.7H5.2a1.7 1.7 0 0 0-1.7 1.7v6.6a1.7 1.7 0 0 0 1.7 1.7h.3" />
    </svg>
);

export const LinkIcon = ({size = 16}: IconProps) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
);
