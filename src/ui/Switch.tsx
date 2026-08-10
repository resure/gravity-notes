import {Switch as BaseSwitch} from '@base-ui/react/switch';

import './controls.css';

export interface SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    'aria-label'?: string;
    id?: string;
    disabled?: boolean;
}

/** One of the two kinds of setting control the app has (§08); the other is `ToggleGroup`. */
export function Switch({checked, onChange, disabled, id, ...aria}: SwitchProps) {
    return (
        <BaseSwitch.Root
            {...aria}
            id={id}
            className="ui-switch"
            checked={checked}
            disabled={disabled}
            onCheckedChange={onChange}
        >
            <BaseSwitch.Thumb className="ui-switch__thumb" />
        </BaseSwitch.Root>
    );
}
