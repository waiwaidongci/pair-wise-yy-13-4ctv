import { alpha, createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#2f6fe4",
    },
    secondary: {
      main: "#0b8a73",
    },
    success: {
      main: "#16825d",
    },
    warning: {
      main: "#c77b1f",
    },
    error: {
      main: "#c44556",
    },
    background: {
      default: "#eef1f5",
      paper: "#ffffff",
    },
    text: {
      primary: "#172033",
      secondary: "#667287",
    },
    divider: alpha("#172033", 0.1),
  },
  shape: {
    borderRadius: 9,
  },
  typography: {
    fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
    button: {
      fontWeight: 750,
      textTransform: "none",
    },
    h5: {
      fontWeight: 850,
    },
    h6: {
      fontWeight: 850,
    },
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
  },
});
