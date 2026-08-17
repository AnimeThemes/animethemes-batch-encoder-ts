export type VideoFilter = {
    filter: string;
    filename: string;
};

export type VideoFilterPreset = {
    id: string;
    label: string;
    filter: string;
    filename: string;
};

export const videoFilterPresets = [
    {   
        id: "none",
        label: "None",
        filter: "",
        filename: "",
    },
    {
        id: "720p",
        label: "scale=-1:720",
        filter: "scale=-1:720",
        filename: "720p",
    },
    {
        id: "nuked-720p",
        label: "scale=-1:720,hqdn3d=0:0:3:3,gradfun,unsharp",
        filter: "scale=-1:720,hqdn3d=0:0:3:3,gradfun,unsharp",
        filename: "nuked-720p",
    },
    {
        id: "nuked",
        label: "hqdn3d=0:0:3:3,gradfun,unsharp",
        filter: "hqdn3d=0:0:3:3,gradfun,unsharp",
        filename: "nuked",
    },
    {
        id: "lightdenoise",
        label: "hqdn3d=0:0:3:3",
        filter: "hqdn3d=0:0:3:3",
        filename: "lightdenoise",
    },
    {
        id: "heavydenoise",
        label: "hqdn3d=1.5:1.5:6:6",
        filter: "hqdn3d=1.5:1.5:6:6",
        filename: "heavydenoise",
    },
    {
        id: "unsharp",
        label: "unsharp",
        filter: "unsharp",
        filename: "unsharp",
    },
] satisfies VideoFilterPreset[];