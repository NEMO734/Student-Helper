using System;
using System.Windows;
using Velopack;

namespace Student_Helper
{
    public static class Program
    {
        [STAThread]
        public static void Main(string[] args)
        {
            // Velopack installer, shortcut, and update hook
            VelopackApp.Build().Run();

            var app = new Application();
            app.Run(new MainWindow());
        }
    }
}